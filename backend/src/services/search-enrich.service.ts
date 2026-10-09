// Enriquecimento via busca web: acha Instagram e site próprio de um lead sem
// site próprio. O provedor fica atrás de SearchProvider (hoje Tavily). A
// extração é pura (testável com resposta mockada).
import { env } from '../config/env'
import { OPERATIONS, type QuotaRun } from './api-quota.service'
import { cacheKeyOf, guardedCall, ProviderAuthError, ProviderPlanLimitError, ProviderRateLimitError, type GuardedResult } from './api-guard.service'
import { phonesInText } from './contact-normalize'
import { candidateBase, siteKeyOf } from './url-classify.service'
import type { AddressComponent } from './places.service'
import { classifyDomain, isBlockedDomain, isInstitutionalDomain, isSocialHost, looksLikeAggregator, normalizeNameTokens, registrableDomain } from './domain-classifier.service'
import { nameHasCity, rejectFoundSite } from './found-site-rules.service'
import { classifySite, extractInstagramHandle, isInstagramHost } from './site-kind.service'

export interface SearchResult {
  title: string
  url: string
  content: string
}
export interface EnrichmentResult {
  instagramHandle: string | null
  foundWebsite: string | null
  bioUrl: string | null // página de link na bio citada nos resultados (resolvida sem gastar busca)
  // Nome bateu mas a cidade não (ou houve empate entre perfis): é só sugestão, precisa de confirmação.
  instagramVerificar: boolean
  foundWebsiteVerificar: boolean
  // Todos os domínios próprios plausíveis (um por domínio registrável) — a decisão final compara, não escolhe às cegas.
  candidates?: { origin: string; strength: Strength }[]
  searches?: number // chamadas Tavily realmente feitas
  quotaSkipped?: boolean // faltou orçamento no meio: ausência de resultado NÃO é evidência negativa
}

// Onde o lead fica, pra separar homônimos de outras cidades.
export interface LeadLocation {
  city: string | null
  state: string | null // sigla ou nome
  address?: string | null // formattedAddress do Places
  addressComponents?: AddressComponent[] | null
}

export type Strength = 'forte' | 'fraca'

export class SearchQuotaError extends Error {}

export interface SearchProvider {
  search(query: string): Promise<SearchResult[]>
}

const TAVILY_URL = 'https://api.tavily.com/search'
const TIMEOUT_MS = 15000
const TAVILY_CACHE_VERSION = 'v1'

// Parâmetros de CUSTO explícitos: nada de auto_parameters (poderia escolher search_depth=advanced = 2 créditos),
// nada de resposta LLM nem conteúdo bruto. search_depth=basic = 1 crédito (verificado na doc oficial em 2026-10-01).
export const TAVILY_PARAMS = { search_depth: 'basic', auto_parameters: false, include_answer: false, include_raw_content: false, include_images: false, max_results: 10, topic: 'general', include_usage: true } as const

export class TavilyProvider implements SearchProvider {
  constructor(private readonly apiKey: string) {}

  async search(query: string): Promise<SearchResult[]> {
    const res = await fetch(TAVILY_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, ...TAVILY_PARAMS }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (res.status === 401) throw new ProviderAuthError('Tavily: chave ausente ou inválida (401)')
    if (res.status === 429) throw new ProviderRateLimitError('Tavily: rate limit (429)', Number(res.headers.get('retry-after') ?? 0) * 1000 || undefined)
    if (res.status === 432 || res.status === 433) throw new ProviderPlanLimitError(`Tavily: limite do plano/pay-as-you-go (${res.status})`)
    if (!res.ok) throw new Error(`Tavily respondeu ${res.status}`)
    const data = (await res.json()) as { results?: Partial<SearchResult>[]; usage?: { credits?: number } }
    if ((data.usage?.credits ?? 1) > 1) console.error(`[tavily] ATENÇÃO: a busca consumiu ${data.usage?.credits} créditos (esperado 1)`)
    return (data.results ?? []).map((r) => ({ title: r.title ?? '', url: r.url ?? '', content: (r.content ?? '').slice(0, 400) }))
  }
}

function fold(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

// O nome do negócio (sem palavras genéricas) precisa aparecer no título ou conteúdo — evita homônimos.
export function mentionsBusiness(r: SearchResult, leadName: string): boolean {
  const text = fold(`${r.title} ${r.content}`)
  const tokens = normalizeNameTokens(leadName).filter((t) => t.length >= 3)
  if (tokens.length === 0) return text.includes(fold(leadName).trim())
  // Snippets do Tavily vêm cortados: tolera até ~30% dos tokens ausentes.
  const needed = Math.max(1, Math.ceil(tokens.length * 0.7))
  return tokens.filter((t) => text.includes(t)).length >= needed
}

function isOwnDomain(link: string, leadName: string, handle?: string | null): boolean {
  let host: string
  try {
    host = new URL(link).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return false
  }
  if (isBlockedDomain(host) || isInstitutionalDomain(host) || isSocialHost(host) || looksLikeAggregator(host, leadName, handle)) return false
  return classifySite(link).kind === 'site_proprio' && classifyDomain(host) === 'candidato'
}

function isBioHost(link: string): boolean {
  try {
    return classifyDomain(new URL(link).hostname) === 'link_na_bio'
  } catch {
    return false
  }
}

const STATES: Record<string, string> = {
  ac: 'acre', al: 'alagoas', ap: 'amapa', am: 'amazonas', ba: 'bahia', ce: 'ceara', df: 'distrito federal',
  es: 'espirito santo', go: 'goias', ma: 'maranhao', mt: 'mato grosso', ms: 'mato grosso do sul', mg: 'minas gerais',
  pa: 'para', pb: 'paraiba', pr: 'parana', pe: 'pernambuco', pi: 'piaui', rj: 'rio de janeiro', rn: 'rio grande do norte',
  rs: 'rio grande do sul', ro: 'rondonia', rr: 'roraima', sc: 'santa catarina', sp: 'sao paulo', se: 'sergipe', to: 'tocantins',
}
const STREET_PREFIX = /^(rua|r\.|av|av\.|avenida|rod|rodovia|estrada|travessa|alameda|praca|servidao|beco)\b/

// Termos "fortes": cidade e localidades do endereço (bairro/cidade vizinha). Estado sozinho é "fraco" —
// vários homônimos existem dentro do mesmo estado.
function locationTerms(loc: LeadLocation): { strong: string[]; weak: string[] } {
  const strong = new Set<string>()
  if (loc.city) strong.add(fold(loc.city).trim())
  for (const part of (loc.address ?? '').split(/[,\-–]/)) {
    const t = fold(part).trim()
    if (t.length >= 4 && t.length <= 40 && !/\d/.test(t) && !STREET_PREFIX.test(t) && !/^brasil$/.test(t)) strong.add(t)
  }
  // Componentes do Places (New): município, distrito, bairro, localidade... entram como fortes.
  // Estado vira fraco; rua, número, CEP e país não identificam o lugar.
  const weak = new Set<string>()
  for (const c of loc.addressComponents ?? []) {
    const types = c.types ?? []
    if (types.some((t) => ['route', 'street_number', 'postal_code', 'postal_code_suffix', 'country', 'premise', 'subpremise'].includes(t))) continue
    const target = types.includes('administrative_area_level_1') ? weak : strong
    for (const text of [c.longText, c.shortText]) {
      const t = fold(text ?? '').trim()
      if (t.length >= (target === weak ? 2 : 4) && t.length <= 40 && !/\d/.test(t)) target.add(t)
    }
  }
  const st = fold(loc.state ?? '').trim()
  if (st) {
    weak.add(st)
    if (STATES[st]) weak.add(STATES[st])
    const abbr = Object.keys(STATES).find((k) => STATES[k] === st)
    if (abbr) weak.add(abbr)
  }
  return { strong: [...strong].filter(Boolean), weak: [...weak] }
}

function hasWord(text: string, term: string): boolean {
  return new RegExp(`(^|[^a-z0-9])${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`).test(text)
}


// DDDs por estado: um telefone com DDD do estado do lead conta como evidência de local.
const DDDS: Record<string, string[]> = {
  ac: ['68'], al: ['82'], ap: ['96'], am: ['92', '97'], ba: ['71', '73', '74', '75', '77'], ce: ['85', '88'], df: ['61'],
  es: ['27', '28'], go: ['62', '64'], ma: ['98', '99'], mt: ['65', '66'], ms: ['67'], mg: ['31', '32', '33', '34', '35', '37', '38'],
  pa: ['91', '93', '94'], pb: ['83'], pr: ['41', '42', '43', '44', '45', '46'], pe: ['81', '87'], pi: ['86', '89'],
  rj: ['21', '22', '24'], rn: ['84'], rs: ['51', '53', '54', '55'], ro: ['69'], rr: ['95'], sc: ['47', '48', '49'],
  sp: ['11', '12', '13', '14', '15', '16', '17', '18', '19'], se: ['79'], to: ['63'],
}

function stateAbbr(state: string | null): string | null {
  const st = fold(state ?? '').trim()
  if (STATES[st]) return st
  return Object.keys(STATES).find((k) => STATES[k] === st) ?? null
}

// Menção a OUTRO estado no conteúdo ("Paraíba", "Laguna - PB") ou grudado à cidade no domínio (lagunapb).
function mentionsOtherState(r: SearchResult, loc: LeadLocation): boolean {
  const own = stateAbbr(loc.state)
  if (!own) return false
  const text = fold(`${r.title} ${r.content}`)
  const city = fold(loc.city ?? '').replace(/[^a-z0-9]/g, '')
  let slug = ''
  try {
    slug = registrableDomain(new URL(r.url).hostname).replace(/\.[a-z.]+$/, '').replace(/[^a-z0-9]/g, '')
  } catch { /* url inválida: só o texto conta */ }
  return Object.keys(STATES).some((ab) => {
    if (ab === own) return false
    if (STATES[ab] !== 'para' && hasWord(text, STATES[ab])) return true
    if (new RegExp(`[-,/]\\s*${ab}(?![a-z0-9])`).test(text)) return true
    return city.length >= 3 && slug.endsWith(`${city}${ab}`)
  })
}

// Cidade/localidade no título ou conteúdo = forte; só estado (SC, Santa Catarina) = fraca; nada = null.
// Se o nome do negócio já contém a cidade, exige outra evidência (bairro, estado, DDD).
function locationStrength(r: SearchResult, loc: LeadLocation, leadName: string): Strength | null {
  const text = fold(`${r.title} ${r.content}`)
  const terms = locationTerms(loc)
  if (nameHasCity(leadName, loc.city)) {
    const city = fold(loc.city ?? '').trim()
    const abbr = stateAbbr(loc.state)
    const ddd = (abbr ? DDDS[abbr] : []).some((d) => new RegExp(`(^|[^0-9])\\(?${d}\\)?[\\s.-]?9?\\d{4}[\\s.-]?\\d{4}`).test(text))
    const other = terms.strong.filter((t) => t !== city && !city.includes(t))
    return other.some((t) => hasWord(text, t)) || terms.weak.some((t) => hasWord(text, t)) || ddd ? 'forte' : null
  }
  if (terms.strong.some((t) => hasWord(text, t))) return 'forte'
  if (terms.weak.some((t) => hasWord(text, t))) return 'fraca'
  return null
}

export function extractFromResults(results: SearchResult[], leadName: string, loc: LeadLocation, knownHandle?: string | null, phone?: string | null): EnrichmentResult {
  const out: EnrichmentResult = { instagramHandle: null, foundWebsite: null, bioUrl: null, instagramVerificar: false, foundWebsiteVerificar: false }
  const insta: { handle: string; strength: Strength }[] = []
  const sites: { origin: string; strength: Strength }[] = []
  const cityIsName = nameHasCity(leadName, loc.city)

  const phoneKey = phone ? [...phonesInText(phone)][0] ?? null : null
  for (const r of results) {
    // Telefone exato do Places no resultado é evidência forte de identidade (mesmo sem o nome inteiro no snippet).
    const phoneHit = !!phoneKey && phonesInText(`${r.title} ${r.content}`).has(phoneKey)
    if (!r.url || (!phoneHit && !mentionsBusiness(r, leadName))) continue
    if (cityIsName && !phoneHit && mentionsOtherState(r, loc)) continue // homônimo de outro estado
    // Nome bateu mas a cidade não: só entra como sugestão ("fraca"), nunca como confirmado.
    const strength: Strength = phoneHit ? 'forte' : locationStrength(r, loc, leadName) ?? 'fraca'
    let url: URL
    try {
      url = new URL(r.url)
    } catch {
      continue
    }
    if (isInstagramHost(url.hostname)) {
      const handle = extractInstagramHandle(r.url)
      if (handle) insta.push({ handle, strength })
    } else if (isOwnDomain(r.url, leadName, knownHandle)) {
      sites.push({ origin: candidateBase(r.url) ?? url.origin, strength }) // origem do site (em plataforma compartilhada, a página do negócio)
    } else if (!out.bioUrl && isBioHost(r.url) && strength === 'forte') {
      out.bioUrl = r.url
    }
  }

  // Instagram: prefere perfil com a cidade no snippet; vários fortes diferentes = empate -> verificar.
  const fortes = [...new Map(insta.filter((i) => i.strength === 'forte').map((i) => [i.handle, i])).values()]
  if (fortes.length > 0) {
    out.instagramHandle = fortes[0].handle
    out.instagramVerificar = fortes.length > 1
  } else if (insta.length > 0) {
    out.instagramHandle = insta[0].handle
    out.instagramVerificar = true
  }

  // Domínio sem relação com o nome/@ é descartado (nem como sugestão). Confirmado = relacionado E cidade forte;
  // relacionado mas sem confirmação de cidade = "verificar".
  const related = sites.filter((x) => !rejectFoundSite(x.origin, { arenaName: leadName, city: loc.city, state: loc.state, instagramHandle: out.instagramHandle ?? knownHandle }))
  out.candidates = [...new Map(related.map((x) => [siteKeyOfBase(x.origin), x])).values()]
  const siteForte = related.find((x) => x.strength === 'forte')
  if (siteForte) out.foundWebsite = siteForte.origin
  else if (related.length > 0) {
    out.foundWebsite = related[0].origin
    out.foundWebsiteVerificar = true
  }
  return out
}

let provider: SearchProvider | null | undefined
function getProvider(): SearchProvider | null {
  if (provider === undefined) provider = env.TAVILY_API_KEY ? new TavilyProvider(env.TAVILY_API_KEY) : null
  return provider
}

export function isSearchConfigured(): boolean {
  return getProvider() !== null
}

export function _setSearchProviderForTests(p: SearchProvider | null | undefined): void { provider = p }

// Segunda busca: com o @ do Instagram, procura o domínio próprio. Aceita o domínio se o nome do
// negócio OU o @ aparece no título/conteúdo; a cidade confirma, senão fica "verificar".
export function extractSiteByHandle(results: SearchResult[], leadName: string, handle: string, loc: LeadLocation): { foundWebsite: string; verificar: boolean } | null {
  const h = fold(handle)
  const cityIsName = nameHasCity(leadName, loc.city)
  const sites: { origin: string; strength: Strength }[] = []
  for (const r of results) {
    if (!r.url || !isOwnDomain(r.url, leadName, handle)) continue
    if (!mentionsBusiness(r, leadName) && !fold(`${r.title} ${r.content}`).includes(h)) continue
    if (cityIsName && mentionsOtherState(r, loc)) continue
    const origin = candidateBase(r.url) ?? new URL(r.url).origin
    if (rejectFoundSite(origin, { arenaName: leadName, city: loc.city, state: loc.state, instagramHandle: handle })) continue // bloqueado/sem relação/outro estado: descarta
    sites.push({ origin, strength: locationStrength(r, loc, leadName) ?? 'fraca' })
  }
  const forte = sites.find((x) => x.strength === 'forte')
  if (forte) return { foundWebsite: forte.origin, verificar: false }
  return sites.length > 0 ? { foundWebsite: sites[0].origin, verificar: true } : null
}

// Uma consulta Tavily: cache persistente (consulta normalizada + parâmetros de custo + versão) → dedupe → reserva atômica
// → chamada. Quem decide O QUE consultar é a investigação (investigation.service); aqui só se executa UMA consulta.
export async function searchTavily(query: string, opts: { run?: QuotaRun; refresh?: boolean } = {}): Promise<GuardedResult<SearchResult[]> | { status: 'NOT_CONFIGURED' }> {
  const p = getProvider()
  if (!p) return { status: 'NOT_CONFIGURED' }
  return guardedCall<SearchResult[]>({
    provider: 'TAVILY',
    operation: OPERATIONS.TAVILY_SEARCH,
    cacheKey: cacheKeyOf('TAVILY', OPERATIONS.TAVILY_SEARCH, TAVILY_CACHE_VERSION, { q: query, ...TAVILY_PARAMS }),
    run: opts.run,
    refresh: opts.refresh,
    classify: (rs) => rs.length > 0
      ? { outcome: 'POSITIVE', ttlMs: env.SEARCH_CACHE_TTL_HOURS * 3600_000 }
      : { outcome: 'NEGATIVE', ttlMs: env.SEARCH_CACHE_NEGATIVE_TTL_HOURS * 3600_000 },
    call: () => p.search(query),
  })
}

function siteKeyOfBase(origin: string): string { return siteKeyOf(origin) ?? origin }
