// Extrai FATOS de uma página já baixada (a mesma resposta do health check — sem 2º download). Os fatos são compactos
// (sem HTML bruto) e ficam salvos em LeadEvidence; a decisão de identidade é recalculada a partir deles, sem rede.
// Telefones são separados por ORIGEM: só tel:/WhatsApp/dado estruturado/seção de contato podem confirmar identidade;
// número achado em conteúdo genérico é registrado mas ignorado como confirmação.
import { canonicalBrPhone, fold, phoneFromLinkValue, phonesInText } from './contact-normalize'

export const FACTS_VERSION = 'pf1'

export interface PhoneBuckets { tel: string[]; whatsapp: string[]; structured: string[]; contact: string[]; generic: string[] }

export interface PageFacts {
  v: string
  url: string
  finalUrl: string
  fetchedAt: string
  httpStatus: number | null
  health: string | null
  evaluable: boolean
  notEvaluableReason: string | null // BLOCKED | HTTP_<n> | ERROR | EMPTY_CONTENT | PARKED | UNREACHABLE
  textLen: number
  identityNames: string[] // title, og:site_name, h1, nome em JSON-LD (sem acento, minúsculo)
  structuredNames: string[] // só os nomes vindos de dados estruturados (JSON-LD de empresa/local)
  structuredTypes: string[]
  phones: PhoneBuckets
  addresses: string[] // endereços estruturados (JSON-LD/<address>), em texto
  structuredCity: string[]
  structuredRegion: string[]
  instagram: string[] // @ linkados na página (href)
  linkHosts: string[] // hosts externos linkados (relação entre sites do mesmo negócio)
  textSample: string // trecho do texto visível, sem acento, p/ nome/cidade
  contactText: string // janelas de texto ao redor de "contato/telefone/endereço/rodapé"
  distinctPhones: number
  multiBusiness: boolean
  // Entidades estruturadas (JSON-LD) com os sinais do MESMO nó juntos: é a única forma de associar nome+telefone+endereço ao
  // mesmo estabelecimento numa página que lista várias empresas/unidades. Opcional: fatos antigos não têm.
  entities?: PageEntity[]
  // Páginas internas relevantes (contato, unidades, sobre), do MESMO host, em ordem de prioridade (máx. 6). Opcional em fatos antigos.
  internalLinks?: string[]
  // "Cidade - UF" / "Cidade/UF" em blocos de contato/endereço/rodapé do TEXTO VISÍVEL (sem depender de JSON-LD): unidades que a página cita.
  unitCities?: string[]
}

const UFS = 'AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO'
const CITY_UF = new RegExp(`([A-ZÀ-Ý][\\p{L}'.]+(?: (?:d[aeo]s?|e|[A-ZÀ-Ý][\\p{L}'.]*)){0,3})\\s*[-–/,]\\s*(${UFS})\\b`, 'gu')
// Cidades citadas como endereço ("Tubarão - SC", "Florianópolis/SC") num texto de contato. Heurístico: serve para detectar
// divergência/presença de unidade, nunca para confirmar sozinho.
export function unitCitiesOf(text: string, max = 12): string[] {
  const out = new Set<string>()
  for (const m of text.matchAll(CITY_UF)) { const c = fold(m[1]).replace(/[^a-z0-9 ]/g, '').trim(); if (c.length >= 3) out.add(c); if (out.size >= max) break }
  return [...out]
}

export interface PageEntity { name: string; phones: string[]; cities: string[]; addresses: string[] }

// Prioridade (menor = antes): contato > unidades/endereço > sobre. Só caminhos que dizem o que são.
const INTERNAL_PRIORITY: [number, RegExp][] = [
  [1, /(^|[/_-])(contato|contatos|contact|contacts|contate|fale-conosco|faleconosco|fale-com-a-gente)([/_.-]|$)/],
  [2, /(^|[/_-])(unidades?|lojas?|filiais?|onde-estamos|localizacao|localiza[cç]ao|como-chegar|enderecos?|address|locations?)([/_.-]|$)/],
  [3, /(^|[/_-])(sobre|sobre-nos|quem-somos|about|about-us|institucional|a-empresa|nossa-historia)([/_.-]|$)/],
]
const ASSET_EXT = /\.(?:jpe?g|png|gif|svg|webp|ico|css|js|pdf|zip|mp4|mp3|xml|json)$/i

export function internalLinksOf(hrefs: string[], finalUrl: string, max = 6): string[] {
  let base: URL
  try { base = new URL(finalUrl) } catch { return [] }
  const host = base.hostname.replace(/^www\./, '').toLowerCase()
  const found = new Map<string, number>()
  for (const h of hrefs) {
    let u: URL
    try { u = new URL(h, base) } catch { continue }
    if (!/^https?:$/.test(u.protocol) || u.hostname.replace(/^www\./, '').toLowerCase() !== host || u.username || u.password) continue
    const path = u.pathname.toLowerCase()
    if (ASSET_EXT.test(path)) continue
    u.hash = ''; u.search = ''
    const norm = u.toString().replace(/\/+$/, '')
    if (norm === finalUrl.replace(/[#?].*$/, '').replace(/\/+$/, '')) continue
    const pri = INTERNAL_PRIORITY.find(([, re]) => re.test(path))?.[0]
    if (pri == null) continue
    found.set(norm, Math.min(found.get(norm) ?? 9, pri))
  }
  return [...found.entries()].sort((a, b) => a[1] - b[1]).slice(0, max).map(([u]) => u)
}

const decode = (s: string) => s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
const squeeze = (s: string) => s.replace(/\s+/g, ' ').trim()
const uniq = <T,>(a: T[]) => [...new Set(a)]

export function visibleText(html: string, max = 250_000): string {
  return squeeze(decode(html.slice(0, max)
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|template|svg)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')))
}

interface LdNode { [k: string]: unknown }
function ldNodes(html: string): LdNode[] {
  const out: LdNode[] = []
  const walk = (n: unknown) => {
    if (Array.isArray(n)) return n.forEach(walk)
    if (!n || typeof n !== 'object') return
    const o = n as LdNode
    out.push(o)
    if (o['@graph']) walk(o['@graph'])
  }
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { walk(JSON.parse(m[1].trim())) } catch { /* JSON-LD quebrado: ignora */ }
  }
  return out
}

const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : v == null ? [] : [v])
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)

const CONTACT_WORD = /(contato|fale conosco|telefone|whatsapp|onde estamos|endereco|localizacao|como chegar|reservas|ligue|tel\b|fone|cel\b)/

function instagramHandleOf(href: string): string | null {
  const m = href.match(/instagram\.com\/([a-z0-9._]{1,30})(?:[/?#"']|$)/i)
  const h = m?.[1]?.toLowerCase()
  return h && !['p', 'reel', 'reels', 'explore', 'stories', 'accounts', 'tv', 'share', 'direct'].includes(h) ? h : null
}

export interface FactsInput { url: string; finalUrl: string; html: string; httpStatus: number | null; blocked?: boolean; health?: string | null }

export function extractPageFacts(i: FactsInput): PageFacts {
  const html = i.html ?? ''
  const text = visibleText(html)
  const foldedText = fold(text)

  // dados estruturados
  const identityNames: string[] = []
  const structuredNames: string[] = []
  const structuredTypes: string[] = []
  const structuredPhones: string[] = []
  const addresses: string[] = []
  const structuredCity: string[] = []
  const structuredRegion: string[] = []
  const igLinks: string[] = []
  const entities: PageEntity[] = []
  for (const n of ldNodes(html)) {
    const types = asArray(n['@type']).map(String)
    const isOrg = types.some((t) => /business|organization|place|hotel|lodging|restaurant|sport|store|service|club|center|gym|arena|stadium/i.test(t))
    if (!isOrg && !n.telephone && !n.address) continue
    structuredTypes.push(...types)
    const name = str(n.name)
    if (name && isOrg) { identityNames.push(fold(name)); structuredNames.push(fold(name)) }
    const ent: PageEntity = { name: name && isOrg ? fold(name) : '', phones: [], cities: [], addresses: [] }
    for (const t of asArray(n.telephone)) { const k = typeof t === 'string' ? canonicalBrPhone(t) : null; if (k) { structuredPhones.push(k); ent.phones.push(k) } }
    for (const a of asArray(n.address)) {
      if (typeof a === 'string') { addresses.push(fold(a)); ent.addresses.push(fold(a)) }
      else if (a && typeof a === 'object') {
        const o = a as LdNode
        const city = str(o.addressLocality); const region = str(o.addressRegion)
        if (city) { structuredCity.push(fold(city)); ent.cities.push(fold(city)) }
        if (region) structuredRegion.push(fold(region))
        const line = fold([o.streetAddress, o.addressLocality, o.addressRegion, o.postalCode].map((x) => str(x) ?? '').filter(Boolean).join(', '))
        addresses.push(line); ent.addresses.push(line)
      }
    }
    if (ent.name && (ent.phones.length || ent.cities.length || ent.addresses.length)) entities.push(ent)
    for (const s of asArray(n.sameAs)) { const h = typeof s === 'string' ? instagramHandleOf(s) : null; if (h) igLinks.push(h) }
  }
  for (const m of html.matchAll(/<address\b[^>]*>([\s\S]{0,600}?)<\/address>/gi)) addresses.push(fold(visibleText(m[1])))

  // títulos / nome da marca
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
  if (title) identityNames.push(fold(squeeze(decode(title))))
  for (const m of html.matchAll(/<meta[^>]+(?:property|name)=["'](?:og:site_name|og:title|application-name)["'][^>]*content=["']([^"']+)["']/gi)) identityNames.push(fold(decode(m[1])))
  for (const m of [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)].slice(0, 3)) identityNames.push(fold(visibleText(m[1])))

  // telefones por origem
  const tel: string[] = []
  const whatsapp: string[] = []
  for (const m of html.matchAll(/href=["']tel:([^"']+)["']/gi)) { const k = phoneFromLinkValue(m[1]); if (k) tel.push(k) }
  for (const m of html.matchAll(/(?:wa\.me\/|api\.whatsapp\.com\/send\/?\?[^"'\s]*?phone=|whatsapp:\/\/send\?[^"'\s]*?phone=|web\.whatsapp\.com\/send\?[^"'\s]*?phone=)\+?(\d{10,13})/gi)) { const k = canonicalBrPhone(m[1]); if (k) whatsapp.push(k) }
  // Seções de contato: blocos (p/div/li/td/h*/br...) que citam contato/telefone/endereço, e o rodapé/<address> inteiros.
  // Telefone num bloco qualquer (ex.: parágrafo de patrocinador) fica "genérico" e não confirma identidade.
  const windows: string[] = []
  const stripped = html.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<(script|style|noscript|template|svg)\b[\s\S]*?<\/\1>/gi, ' ')
  for (const piece of stripped.split(/<\/?(?:p|div|li|ul|ol|tr|td|th|h[1-6]|section|article|header|br|table|span)\b[^>]*>/gi)) {
    if (windows.length >= 20) break
    const t = visibleText(piece)
    if (t.length >= 8 && t.length <= 500 && CONTACT_WORD.test(fold(t))) windows.push(t)
  }
  for (const m of stripped.matchAll(/<(footer|address)\b[^>]*>([\s\S]{0,4000}?)<\/\1>/gi)) windows.push(visibleText(m[2]))
  const contactText = fold(windows.join(' | ')).slice(0, 3000)
  const contact = [...phonesInText(windows.join(' | '))]
  const known = new Set([...tel, ...whatsapp, ...structuredPhones, ...contact])
  const generic = [...phonesInText(text)].filter((k) => !known.has(k))

  // links
  const hrefs = [...html.matchAll(/href=["']([^"'#]+)["']/gi)].map((m) => m[1])
  const instagram = uniq([...igLinks, ...hrefs.map(instagramHandleOf).filter((h): h is string => !!h)])
  let ownHost = ''
  try { ownHost = new URL(i.finalUrl).hostname.replace(/^www\./, '') } catch { /* sem host */ }
  const linkHosts = uniq(hrefs.map((h) => { try { return new URL(h).hostname.replace(/^www\./, '').toLowerCase() } catch { return '' } }).filter((h) => h && h !== ownHost)).slice(0, 40)

  const phones: PhoneBuckets = { tel: uniq(tel), whatsapp: uniq(whatsapp), structured: uniq(structuredPhones), contact: uniq(contact).filter((k) => !tel.includes(k) && !whatsapp.includes(k)), generic: uniq(generic).slice(0, 20) }
  const distinctPhones = new Set([...phones.tel, ...phones.whatsapp, ...phones.structured, ...phones.contact, ...phones.generic]).size
  const names = uniq(identityNames.filter(Boolean))

  let notEvaluableReason: string | null = null
  if (i.health === 'dominio_parado') notEvaluableReason = 'PARKED'
  else if (i.health === 'fora_do_ar') notEvaluableReason = 'UNREACHABLE'
  else if (i.httpStatus == null) notEvaluableReason = 'ERROR'
  else if (i.blocked) notEvaluableReason = 'BLOCKED'
  else if (i.httpStatus >= 400) notEvaluableReason = `HTTP_${i.httpStatus}`
  else if (!html || (text.length < 150 && structuredTypes.length === 0)) notEvaluableReason = 'EMPTY_CONTENT' // shell de JS / página em branco

  return {
    v: FACTS_VERSION, url: i.url, finalUrl: i.finalUrl, fetchedAt: new Date().toISOString(), httpStatus: i.httpStatus, health: i.health ?? null,
    evaluable: notEvaluableReason === null, notEvaluableReason, textLen: text.length,
    identityNames: names.slice(0, 12), structuredNames: uniq(structuredNames).slice(0, 8), structuredTypes: uniq(structuredTypes).slice(0, 8), phones,
    addresses: uniq(addresses.filter(Boolean)).slice(0, 6), structuredCity: uniq(structuredCity), structuredRegion: uniq(structuredRegion),
    instagram: instagram.slice(0, 10), linkHosts, textSample: foldedText.slice(0, 4000), contactText,
    distinctPhones, multiBusiness: distinctPhones >= 5 || new Set(names.filter((n) => n.length > 2)).size >= 6,
    entities: entities.slice(0, 20), internalLinks: internalLinksOf(hrefs, i.finalUrl),
    unitCities: unitCitiesOf(windows.join(' | ')),
  }
}

// Fatos "vazios" para uma tentativa que falhou (rede/bloqueio): registra que a página NÃO foi avaliada.
export function unevaluableFacts(url: string, reason: string, httpStatus: number | null = null, finalUrl = url, health: string | null = null): PageFacts {
  return extractPageFacts({ url, finalUrl, html: '', httpStatus: reason === 'ERROR' ? null : httpStatus, blocked: reason === 'BLOCKED', health })
}

// Une os fatos de páginas do MESMO site (home + páginas internas de contato/sobre/unidades). Quem chama garante o mesmo site
// e não funde páginas de diretório/multiempresa (multiBusiness vem só da página principal).
export function mergePageFacts(home: PageFacts, extra: PageFacts[]): PageFacts {
  const all = [home, ...extra]
  const cat = <K extends 'identityNames' | 'structuredNames' | 'structuredTypes' | 'addresses' | 'structuredCity' | 'structuredRegion' | 'instagram' | 'linkHosts'>(k: K, max: number) => uniq(all.flatMap((f) => f[k])).slice(0, max)
  const bucket = (k: keyof PhoneBuckets) => uniq(all.flatMap((f) => f.phones[k]))
  const phones: PhoneBuckets = { tel: bucket('tel'), whatsapp: bucket('whatsapp'), structured: bucket('structured'), contact: bucket('contact'), generic: bucket('generic').slice(0, 20) }
  return {
    ...home,
    identityNames: cat('identityNames', 20), structuredNames: cat('structuredNames', 12), structuredTypes: cat('structuredTypes', 12), addresses: cat('addresses', 12),
    structuredCity: cat('structuredCity', 20), structuredRegion: cat('structuredRegion', 20), instagram: cat('instagram', 16), linkHosts: cat('linkHosts', 60),
    phones, textSample: all.map((f) => f.textSample).join(' ').slice(0, 12_000), contactText: all.map((f) => f.contactText).join(' | ').slice(0, 9000),
    entities: all.flatMap((f) => f.entities ?? []).slice(0, 30), internalLinks: home.internalLinks,
    unitCities: uniq(all.flatMap((f) => f.unitCities ?? [])).slice(0, 20),
  }
}
