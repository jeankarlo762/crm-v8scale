import { env } from '../config/env'
import { OPERATIONS, type Block, type QuotaRun } from './api-quota.service'
import { GOOGLE_DETAILS_COLLECTION_VERSION } from './website-types'
import { cacheKeyOf, guardedCall, ProviderAuthError, ProviderRateLimitError, type GuardedResult } from './api-guard.service'

// Google Places API (New). Só roda no backend; a chave nunca vai pro frontend.
// DUAS etapas, com SKUs, operações e orçamentos separados:
//  1) DESCOBERTA — places:searchText SÓ com campos Pro (FIELD_MASK): id, nome, endereço, status, tipos, link. Nunca pede
//     telefone, website, nota ou nº de avaliações (SKU Enterprise): assertProMask() recusa qualquer máscara com esses campos.
//     Cada página (nextPageToken) é uma requisição cobrada (provider GOOGLE_TEXT_SEARCH_PRO).
//  2) ENRIQUECIMENTO SELETIVO — Place Details Enterprise (fetchPlaceDetails) só para leads priorizados
//     (provider GOOGLE_PLACE_DETAILS_ENTERPRISE). Ausência de websiteUri na descoberta NÃO significa "sem site".
const PLACES_ENDPOINT = 'https://places.googleapis.com/v1/places:searchText'
const PLACES_CACHE_VERSION = 'v2-pro'
export const FIELD_MASK = 'places.id,places.displayName,places.formattedAddress,places.addressComponents,places.businessStatus,places.primaryType,places.types,places.googleMapsUri,nextPageToken'
// Campos que acionam o SKU Enterprise: PROIBIDOS no Text Search.
export const ENTERPRISE_ONLY_FIELDS = ['nationalPhoneNumber', 'internationalPhoneNumber', 'websiteUri', 'rating', 'userRatingCount', 'currentOpeningHours', 'regularOpeningHours', 'reviews', 'priceLevel'] as const
export function assertProMask(mask: string): void {
  const bad = ENTERPRISE_ONLY_FIELDS.filter((f) => mask.split(',').some((m) => m.trim().replace(/^places\./, '') === f))
  if (bad.length) throw new Error(`FieldMask do Text Search PRO não pode conter campos Enterprise: ${bad.join(', ')}`)
}

// Componente de endereço do Places (New): município, distrito, bairro, estado...
export interface AddressComponent {
  longText?: string
  shortText?: string
  types?: string[]
}

export interface PlaceResult {
  addressComponents: AddressComponent[] | null
  placeId: string
  nome: string
  endereco: string | null
  telefone: string | null
  telefoneInternacional: string | null
  website: string | null
  avaliacao: number | null
  numAvaliacoes: number | null
  businessStatus?: string | null
  primaryType?: string | null
  types?: string[] | null
  googleMapsUri?: string | null
  // Proveniência da resposta (para a evidência do Google): instante REAL da resposta (de cache = quando foi coletada, não agora),
  // se veio de cache e a versão da coleta/máscara que pediu websiteUri.
  collectedAt?: Date
  fromCache?: boolean
  collection?: string
}

interface RawPlace {
  id: string
  displayName?: { text?: string }
  formattedAddress?: string
  addressComponents?: AddressComponent[]
  businessStatus?: string
  primaryType?: string
  types?: string[]
  googleMapsUri?: string
}

// "Tubarão, Itajaí - SC" → ["Tubarão - SC", "Itajaí - SC"]. Se só a última tem
// estado, replica nas outras; quem já tem estado próprio mantém o seu.
export function parseCidades(input: string): string[] {
  const parts = input.split(',').map((p) => p.trim()).filter(Boolean)
  const stateRe = /\s*[-/]\s*([A-Za-z]{2})$/
  const lastState = parts.length ? parts[parts.length - 1].match(stateRe)?.[1]?.toUpperCase() : undefined
  const cidades = parts.map((p) => (stateRe.test(p) || !lastState ? p : `${p} - ${lastState}`))
  return [...new Set(cidades)]
}

function mockPlaces(nicho: string, cidade: string): PlaceResult[] {
  const slug = `${nicho}-${cidade}`.toLowerCase().replace(/[^a-z0-9]+/g, '-')
  const sites = [null, 'https://instagram.com/exemplo', 'https://bit.ly/exemplo', 'https://exemplo-proprio.com.br', null, 'https://linktr.ee/exemplo']
  return sites.map((website, i) => ({
    placeId: `mock-${slug}-${i}`,
    nome: `${nicho} Modelo ${i + 1}`,
    endereco: `Rua Exemplo, ${100 + i} - ${cidade}`,
    addressComponents: null,
    telefone: i % 3 === 2 ? null : `(48) 99${String(100 + i).padStart(3, '0')}-${String(1000 + i * 7)}`,
    telefoneInternacional: null,
    website,
    avaliacao: 3.5 + (i % 4) * 0.4,
    numAvaliacoes: 10 + i * 13,
  }))
}

// ── Geografia ──────────────────────────────────────────────────────────

const fold = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

// "yes": bate com a cidade/UF pedidas; "no": o Google diz que é outro município/estado; "unknown": faltam dados
// (não descarta — só não dá pra provar). Município no Places (New) vem como locality ou administrative_area_level_2.
export function belongsToRequestedCity(p: Pick<PlaceResult, 'addressComponents' | 'endereco'>, city: string, state: string | null): 'yes' | 'no' | 'unknown' {
  const comps = p.addressComponents ?? []
  const want = fold(city)
  const cities = comps.filter((c) => c.types?.some((t) => t === 'locality' || t === 'administrative_area_level_2')).flatMap((c) => [c.longText, c.shortText]).filter((x): x is string => !!x).map(fold)
  const uf = comps.find((c) => c.types?.includes('administrative_area_level_1'))?.shortText?.toUpperCase()
  const country = comps.find((c) => c.types?.includes('country'))?.shortText?.toUpperCase()
  if (country && country !== 'BR') return 'no'
  if (uf && state && uf !== state.toUpperCase()) return 'no'
  if (cities.length > 0) return cities.includes(want) ? 'yes' : 'no'
  // Sem componentes: tenta o endereço formatado ("... - Tubarão - SC, 88700-000, Brasil").
  const addr = fold(p.endereco ?? '')
  if (addr && want && new RegExp(`(^|[^a-z0-9])${want.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`).test(addr)) return 'yes'
  return 'unknown'
}

// ── Consultas ──────────────────────────────────────────────────────────

// Query principal + aliases do nicho (Nicho.termosBusca), sem repetir. Cada uma custa ao menos 1 chamada:
// quem limita é MAX_GOOGLE_QUERIES_PER_CITY e o retorno decrescente (searchPlaces).
export function buildQueries(nicho: string, cidade: string, termos: string[] = []): string[] {
  const seen = new Set<string>()
  return [nicho, ...termos].filter((t) => { const k = fold(t); if (!k || seen.has(k)) return false; seen.add(k); return true }).map((t) => `${t} em ${cidade}`)
}

export interface SearchStats {
  calls: number // requisições reais ao Google (cada página conta)
  queries: number
  filtradosForaDaCidade: number
  fechadosPermanentemente: number
  stoppedBy: 'ok' | 'quota' | 'max_requests' | 'diminishing_returns'
}
export interface SearchOptions {
  termos?: string[]
  maxRequests?: number // o que sobra do teto por busca (MAX_GOOGLE_REQUESTS_PER_SEARCH)
  stats?: SearchStats
  run?: QuotaRun // teto por execução (clique em Buscar)
}
export function newSearchStats(): SearchStats {
  return { calls: 0, queries: 0, filtradosForaDaCidade: 0, fechadosPermanentemente: 0, stoppedBy: 'ok' }
}

const PAGE_SIZE = 20
const RETRYABLE = new Set([500, 502, 503, 504])

class PlacesBlockedError extends Error { constructor(readonly block: Block) { super(block.detail) } }

type PlacesPage = { places: RawPlace[]; nextPageToken?: string }
interface PageMeta { collectedAt: Date; fromCache: boolean }

// Uma página do Text Search. TODA tentativa passa pelo guard (cache → dedupe → reserva atômica → chamada), inclusive a
// retentativa de 5xx/rede. 4xx não é retentado; 401/403 pausa a integração (credencial/API), 429 é rate limit.
async function fetchPage(textQuery: string, pageToken: string | undefined, run?: QuotaRun): Promise<PlacesPage & PageMeta> {
  assertProMask(FIELD_MASK) // nunca chama o Text Search com campo Enterprise
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await guardedCall<PlacesPage>({
      provider: 'GOOGLE_TEXT_SEARCH_PRO',
      operation: OPERATIONS.GOOGLE_TEXT_SEARCH,
      cacheKey: cacheKeyOf('GOOGLE_TEXT_SEARCH_PRO', OPERATIONS.GOOGLE_TEXT_SEARCH, PLACES_CACHE_VERSION, { q: textQuery, page: pageToken ?? '', mask: FIELD_MASK, lang: 'pt-BR', region: 'BR', size: PAGE_SIZE }),
      run,
      classify: (d) => ({ outcome: (d.places?.length ?? 0) > 0 ? 'POSITIVE' : 'NEGATIVE', ttlMs: env.PLACES_CACHE_TTL_HOURS * 3600_000 }),
      call: async () => {
        let res: Response
        try {
          res = await fetch(PLACES_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': env.GOOGLE_PLACES_API_KEY as string, 'X-Goog-FieldMask': FIELD_MASK },
            body: JSON.stringify({ textQuery, languageCode: 'pt-BR', regionCode: 'BR', pageSize: PAGE_SIZE, ...(pageToken ? { pageToken } : {}) }),
            signal: AbortSignal.timeout(20000),
          })
        } catch (e) {
          throw Object.assign(new Error(`Falha de rede no Google Places: ${e instanceof Error ? e.message : e}`), { statusCode: 502, retryable: true })
        }
        if (res.ok) { const j = (await res.json()) as { places?: RawPlace[]; nextPageToken?: string }; return { places: j.places ?? [], nextPageToken: j.nextPageToken } }
        if (res.status === 401 || res.status === 403) throw new ProviderAuthError(`Google Places recusou a credencial (${res.status})`)
        if (res.status === 429) throw new ProviderRateLimitError('Google Places: rate limit (429)')
        throw Object.assign(new Error(`Falha na busca do Google Places (${res.status})`), { statusCode: 502, retryable: RETRYABLE.has(res.status) })
      },
    })
    if (r.status === 'OK') return { ...r.data, collectedAt: r.collectedAt, fromCache: r.fromCache }
    if (r.status === 'BLOCKED') throw new PlacesBlockedError(r.block)
    if (r.status === 'IN_FLIGHT') throw Object.assign(new Error('Mesma consulta do Google Places já em andamento'), { statusCode: 409 })
    if (r.status === 'AUTH') throw Object.assign(r.error, { statusCode: 502 })
    if (r.status === 'RATE_LIMITED' || r.status === 'PLAN_LIMIT') throw Object.assign(r.error, { statusCode: 429 })
    const retryable = (r.error as { retryable?: boolean }).retryable
    if (attempt === 0 && retryable) { await new Promise((res) => setTimeout(res, 800)); continue }
    throw Object.assign(r.error, { statusCode: (r.error as { statusCode?: number }).statusCode ?? 502 })
  }
  throw Object.assign(new Error('Falha na busca do Google Places'), { statusCode: 502 })
}

function toPlaceResult(p: RawPlace, meta?: PageMeta): PlaceResult {
  return {
    ...(meta ? { collectedAt: meta.collectedAt, fromCache: meta.fromCache } : {}),
    placeId: p.id,
    nome: p.displayName?.text ?? '(sem nome)',
    endereco: p.formattedAddress ?? null,
    addressComponents: p.addressComponents ?? null,
    // Campos Enterprise NÃO são pedidos na descoberta: ficam nulos até o Place Details (nunca "sem telefone/site" por isso).
    telefone: null,
    telefoneInternacional: null,
    website: null,
    avaliacao: null,
    numAvaliacoes: null,
    businessStatus: p.businessStatus ?? null,
    primaryType: p.primaryType ?? null,
    types: p.types ?? null,
    googleMapsUri: p.googleMapsUri ?? null,
  }
}

// Busca uma cidade: query principal, depois aliases enquanto trouxerem placeIds NOVOS (retorno decrescente),
// paginando só o que existir (nextPageToken) e o orçamento permitir. Devolve placeIds únicos, já filtrados por cidade/UF.
export async function searchPlaces(nicho: string, cidade: string, opts: SearchOptions = {}): Promise<PlaceResult[]> {
  const stats = opts.stats ?? newSearchStats()
  if (env.PLACES_MOCK === 'true') return mockPlaces(nicho, cidade)
  if (!env.GOOGLE_PLACES_API_KEY) {
    throw Object.assign(new Error('GOOGLE_PLACES_API_KEY não configurada no backend'), { statusCode: 500 })
  }
  const state = cidade.match(/[-/]\s*([A-Za-z]{2})$/)?.[1]?.toUpperCase() ?? null
  const cityName = cidade.replace(/\s*[-/]\s*[A-Za-z]{2}$/, '').trim()
  const queries = buildQueries(nicho, cidade, opts.termos).slice(0, env.MAX_GOOGLE_QUERIES_PER_CITY)
  const maxRequests = opts.maxRequests ?? env.MAX_GOOGLE_REQUESTS_PER_SEARCH
  const found = new Map<string, PlaceResult>()

  outer: for (const [qi, query] of queries.entries()) {
    stats.queries += 1
    let novosNaQuery = 0
    let token: string | undefined
    for (let page = 0; page < env.MAX_GOOGLE_PAGES_PER_QUERY; page++) {
      if (stats.calls >= maxRequests) { stats.stoppedBy = 'max_requests'; break outer }
      let data: PlacesPage & PageMeta
      try {
        stats.calls += 1
        data = await fetchPage(query, token, opts.run)
      } catch (e) {
        stats.calls -= e instanceof PlacesBlockedError ? 1 : 0 // não chegou a chamar
        if (e instanceof PlacesBlockedError) { stats.stoppedBy = 'quota'; if (found.size === 0) throw Object.assign(e, { statusCode: 429, message: `Google Places bloqueado: ${e.block.detail}` }); break outer }
        if (qi === 0 && page === 0) throw e // falha da 1ª página: a busca inteira falhou
        console.error(`[places] falha em "${query}" página ${page + 1}, mantendo o que já veio:`, e instanceof Error ? e.message : e)
        break
      }
      let novosNaPagina = 0
      for (const raw of data.places ?? []) {
        if (found.has(raw.id)) continue
        const place = toPlaceResult(raw, data)
        if (place.businessStatus === 'CLOSED_PERMANENTLY') { stats.fechadosPermanentemente += 1; continue }
        if (belongsToRequestedCity(place, cityName, state) === 'no') { stats.filtradosForaDaCidade += 1; continue }
        found.set(place.placeId, place)
        novosNaPagina += 1
      }
      novosNaQuery += novosNaPagina
      token = data.nextPageToken
      if (!token || novosNaPagina === 0) break
    }
    // Retorno decrescente: alias que quase não trouxe nada novo encerra a expansão.
    if (qi > 0 && novosNaQuery < env.GOOGLE_EXPANSION_MIN_NEW) { stats.stoppedBy = 'diminishing_returns'; break }
  }
  console.log(`[places] "${nicho}" em ${cidade}: ${found.size} únicos, ${stats.calls} chamadas, ${stats.queries} queries, ${stats.filtradosForaDaCidade} fora da cidade, parou por ${stats.stoppedBy}`)
  return [...found.values()]
}

// ── Enriquecimento seletivo: Place Details ENTERPRISE (telefone, website, nota, avaliações) ──────────────────────────
// Só para leads PRIORIZADOS. Operação e orçamento PRÓPRIOS (GOOGLE_PLACE_DETAILS_ENTERPRISE), nunca misturados com o Text
// Search Pro. TODA tentativa passa pelo guard (cache → dedupe → reserva atômica), inclusive a retentativa de 5xx/rede; a
// resposta vira evidência do campo websiteUri com a data REAL (de cache = a coleta original).
const DETAILS_ENDPOINT = 'https://places.googleapis.com/v1/places/'
export const DETAILS_FIELD_MASK = 'id,nationalPhoneNumber,internationalPhoneNumber,websiteUri,rating,userRatingCount'
export interface PlaceDetails { placeId: string; websiteUri: string | null; nationalPhone: string | null; internationalPhone: string | null; rating: number | null; userRatingCount: number | null; collection: string }
export type PlaceWebsiteField = PlaceDetails // compat

export async function fetchPlaceDetails(placeId: string, o: { run?: QuotaRun; refresh?: boolean } = {}): Promise<GuardedResult<PlaceDetails> | { status: 'NOT_CONFIGURED' }> {
  if (env.PLACES_MOCK === 'true' || !env.GOOGLE_PLACES_API_KEY || placeId.startsWith('mock-')) return { status: 'NOT_CONFIGURED' }
  let last: GuardedResult<PlaceDetails> | null = null
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await guardedCall<PlaceDetails>({
      provider: 'GOOGLE_PLACE_DETAILS_ENTERPRISE',
      operation: OPERATIONS.GOOGLE_PLACE_DETAILS,
      cacheKey: cacheKeyOf('GOOGLE_PLACE_DETAILS_ENTERPRISE', OPERATIONS.GOOGLE_PLACE_DETAILS, GOOGLE_DETAILS_COLLECTION_VERSION, { id: placeId, mask: DETAILS_FIELD_MASK }),
      run: o.run, refresh: o.refresh,
      classify: (d) => ({ outcome: d.websiteUri || d.nationalPhone || d.internationalPhone ? 'POSITIVE' : 'NEGATIVE', ttlMs: env.GOOGLE_EVIDENCE_TTL_HOURS * 3600_000 }),
      call: async () => {
        let res: Response
        try {
          res = await fetch(`${DETAILS_ENDPOINT}${encodeURIComponent(placeId)}`, { headers: { 'X-Goog-Api-Key': env.GOOGLE_PLACES_API_KEY as string, 'X-Goog-FieldMask': DETAILS_FIELD_MASK }, signal: AbortSignal.timeout(20000) })
        } catch (e) {
          throw Object.assign(new Error(`Falha de rede no Google Places: ${e instanceof Error ? e.message : e}`), { statusCode: 502, retryable: true })
        }
        if (res.status === 401 || res.status === 403) throw new ProviderAuthError(`Google Places recusou a credencial (${res.status})`)
        if (res.status === 429) throw new ProviderRateLimitError('Google Places: rate limit (429)')
        if (!res.ok) throw Object.assign(new Error(`Place Details do Google falhou (${res.status})`), { statusCode: 502, retryable: RETRYABLE.has(res.status) })
        const j = (await res.json()) as { id?: string; websiteUri?: string; nationalPhoneNumber?: string; internationalPhoneNumber?: string; rating?: number; userRatingCount?: number }
        // Resposta sem o id pedido não prova nada sobre os campos: erro técnico, nunca "sem site".
        if (j.id !== placeId) throw Object.assign(new Error('Place Details devolveu outro id/resposta inválida'), { statusCode: 502 })
        return { placeId, websiteUri: j.websiteUri ?? null, nationalPhone: j.nationalPhoneNumber ?? null, internationalPhone: j.internationalPhoneNumber ?? null, rating: j.rating ?? null, userRatingCount: j.userRatingCount ?? null, collection: GOOGLE_DETAILS_COLLECTION_VERSION }
      },
    })
    last = r
    if (r.status === 'ERROR' && attempt === 0 && (r.error as { retryable?: boolean }).retryable) { await new Promise((res) => setTimeout(res, 800)); continue }
    break
  }
  return last as GuardedResult<PlaceDetails>
}
export const fetchPlaceWebsiteField = fetchPlaceDetails // compat
