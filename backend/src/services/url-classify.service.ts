// Ponto único para "que tipo de URL é essa?": normaliza e classifica em site próprio vs perfil/página de terceiro.
// Compõe as listas que já existem (domain-classifier, site-kind, site-blocklist) — não duplica listas.
// Subdomínio de construtor (empresa.wixsite.com) continua OWN_WEBSITE: só plataformas que hospedam
// PERFIS de vários negócios (Booking, iFood, diretórios) são terceiros.
import { getDomain } from 'tldts'
import { classifyDomain, isBlockedDomain, isInstitutionalDomain } from './domain-classifier.service'
import { classifySite } from './site-kind.service'

// TIPO da URL, não vínculo: OWN_WEBSITE / SHARED_PLATFORM_SITE = "site de empresa (não é rede/diretório/marketplace)"
// e NUNCA significam "pertence a este lead" — isso é decidido pela identidade (website-identity).
export type UrlKind =
  | 'OWN_WEBSITE' | 'SHARED_PLATFORM_SITE' | 'INSTAGRAM' | 'FACEBOOK' | 'WHATSAPP' | 'LINK_IN_BIO'
  | 'MARKETPLACE' | 'DIRECTORY' | 'BOOKING_PLATFORM' | 'OTHER_THIRD_PARTY' | 'UNKNOWN'

export interface ClassifiedUrl {
  kind: UrlKind
  url: string | null // normalizada (sem tracking, sem barra final)
  host: string | null // sem www, minúsculo
  domain: string | null // domínio registrável (eTLD+1)
  siteKey: string | null // identidade do SITE: domínio registrável, ou host/caminho em plataforma compartilhada
}

const TRACKING_PARAMS = /^(utm_|fbclid$|gclid$|gbraid$|wbraid$|igshid$|igsh$|mc_|_ga$|ref$|hl$)/i
const WHATSAPP_HOSTS = ['wa.me', 'wa.link', 'whatsapp.com']
const BOOKING_HOSTS = ['booking.com', 'airbnb', 'expedia', 'trivago', 'decolar', 'tripadvisor', 'hoteis.com']
const MARKETPLACE_HOSTS = ['ifood.com.br', 'mercadolivre.com.br', 'olx.com.br', 'shopee.com.br', 'rappi.com.br', 'aiqfome.com', 'goomer.app', 'menudino.com', 'cardapioweb.com']

const hostIs = (host: string, d: string) => host === d || host.endsWith(`.${d}`)

// Plataformas que hospedam sites de MUITOS negócios: o subdomínio (ou o caminho) é que identifica o negócio, não o
// domínio registrável. "a.wixsite.com" e "b.wixsite.com" são empresas diferentes.
const SUBDOMAIN_PLATFORMS = [
  'wixsite.com', 'wordpress.com', 'blogspot.com', 'weebly.com', 'webnode.com.br', 'webnode.com', 'webflow.io', 'netlify.app', 'vercel.app',
  'github.io', 'myshopify.com', 'squarespace.com', 'site123.me', 'yolasite.com', 'jimdosite.com', 'mystrikingly.com', 'godaddysites.com',
  'lojaintegrada.com.br', 'tray.com.br', 'pages.dev', 'framer.website', 'notion.site',
]
// Plataformas por subdomínio em que o CAMINHO também identifica o site: user.wixsite.com/clinica-a ≠ user.wixsite.com/clinica-b.
// n = quantos segmentos iniciais do caminho fazem parte da identidade (as demais páginas do site ficam sob o mesmo site).
const SUBDOMAIN_PATH_SEGMENTS: Record<string, number> = { 'wixsite.com': 1 }
// Plataformas por caminho: /view/<site>, /site/<site> (Google Sites clássico) e /a/<domínio>/<site> (Google Workspace).
const PATH_PLATFORMS: { host: string; re: RegExp }[] = [{ host: 'sites.google.com', re: /^\/(?:view\/[^/]+|site\/[^/]+|[a-z]\/[^/]+\/[^/]+)/i }]
// Padrão genérico de plataforma por caminho: /site/<negócio>, /empresa/<negócio>...
const GENERIC_PATH_RE = /^\/(site|sites|pagina|empresa|perfil|clube)\/([^/?#]+)/i

function sharedPlatformKey(host: string, pathname: string): string | null {
  const sub = SUBDOMAIN_PLATFORMS.find((d) => host !== d && hostIs(host, d))
  if (sub) {
    const parts = pathname.split('/').filter(Boolean).slice(0, SUBDOMAIN_PATH_SEGMENTS[sub] ?? 0).map((x) => x.toLowerCase())
    return parts.length ? `${host}/${parts.join('/')}` : host // empresa.weebly.com | usuario.wixsite.com/clinica-a
  }
  const pp = PATH_PLATFORMS.find((p) => host === p.host)
  if (pp) { const m = pathname.match(pp.re); return m ? `${host}${m[0].toLowerCase()}` : null }
  const g = pathname.match(GENERIC_PATH_RE)
  return g ? `${host}/${g[1].toLowerCase()}/${g[2].toLowerCase()}` : null
}

export function normalizeUrl(raw: string | null | undefined): { url: string; host: string; domain: string } | null {
  const t = raw?.trim()
  if (!t) return null
  let u: URL
  try {
    u = new URL(/^https?:\/\//i.test(t) ? t : `https://${t}`)
  } catch {
    return null
  }
  if (!u.hostname.includes('.')) return null
  const host = u.hostname.toLowerCase().replace(/^www\./, '')
  for (const k of [...u.searchParams.keys()]) if (TRACKING_PARAMS.test(k)) u.searchParams.delete(k)
  u.hash = ''
  const path = u.pathname.replace(/\/+$/, '')
  const query = u.searchParams.toString()
  return { url: `${u.protocol}//${host}${path}${query ? `?${query}` : ''}`, host, domain: getDomain(host) ?? host }
}

export function classifyUrl(raw: string | null | undefined): ClassifiedUrl {
  const n = normalizeUrl(raw)
  if (!n) return { kind: 'UNKNOWN', url: null, host: null, domain: null, siteKey: null }
  let pathname = ''
  try { pathname = new URL(n.url).pathname } catch { /* mantém vazio */ }
  const shared = sharedPlatformKey(n.host, pathname)
  const base = { url: n.url, host: n.host, domain: n.domain, siteKey: shared ?? n.domain }
  const kindOf = (): UrlKind => {
    // sites.google.com está sob google.com (bloqueado como domínio), mas /view/<negócio> é o site DE um negócio
    const siteBuilderHost = PATH_PLATFORMS.some((p) => p.host === n.host)
    if (shared && (siteBuilderHost || !isBlockedDomain(n.host)) && classifyDomain(n.host) !== 'rede_social') return 'SHARED_PLATFORM_SITE'
    const site = classifySite(n.url).kind
    if (site === 'so_instagram') return 'INSTAGRAM'
    if (site === 'so_facebook') return 'FACEBOOK'
    if (WHATSAPP_HOSTS.some((d) => hostIs(n.host, d))) return 'WHATSAPP'
    if (classifyDomain(n.host) === 'link_na_bio') return 'LINK_IN_BIO'
    if (BOOKING_HOSTS.some((d) => n.host.split('.').includes(d.replace(/\..*$/, '')) || hostIs(n.host, d))) return 'BOOKING_PLATFORM'
    if (MARKETPLACE_HOSTS.some((d) => hostIs(n.host, d))) return 'MARKETPLACE'
    if (isBlockedDomain(n.host)) return 'DIRECTORY'
    if (site === 'link_bio' || site === 'so_ota' || isInstitutionalDomain(n.host)) return 'OTHER_THIRD_PARTY'
    return 'OWN_WEBSITE'
  }
  return { ...base, kind: kindOf() }
}

export const isOwnWebsiteKind = (k: UrlKind) => k === 'OWN_WEBSITE'
// Candidato a site de empresa (próprio ou em plataforma compartilhada) — ainda SEM vínculo com o lead.
export const isCandidateSiteKind = (k: UrlKind) => k === 'OWN_WEBSITE' || k === 'SHARED_PLATFORM_SITE'

// Chave de identidade do site de uma URL (destino final): dedupe por ela, nunca só pelo domínio registrável.
export function siteKeyOf(raw: string | null | undefined): string | null { return classifyUrl(raw).siteKey }
export const isSocialKind = (k: UrlKind) => k === 'INSTAGRAM' || k === 'FACEBOOK' || k === 'WHATSAPP' || k === 'LINK_IN_BIO'

// Slug que identifica o negócio numa plataforma compartilhada (subdomínio ou último trecho do caminho); null se o site não é compartilhado.
export function sharedSlugOf(raw: string | null | undefined): string | null {
  const c = classifyUrl(raw)
  if (c.kind !== 'SHARED_PLATFORM_SITE' || !c.siteKey) return null
  return c.siteKey.includes('/') ? c.siteKey.split('/').pop() ?? null : c.siteKey.split('.')[0]
}

// Todos os rótulos que podem nomear o negócio numa plataforma compartilhada: subdomínio (usuário/conta) E segmentos do caminho
// que fazem parte da identidade (Wix: usuario.wixsite.com/<site>). Vazio se o site não é de plataforma compartilhada.
export function sharedSlugsOf(raw: string | null | undefined): string[] {
  const c = classifyUrl(raw)
  if (c.kind !== 'SHARED_PLATFORM_SITE' || !c.siteKey) return []
  const [host, ...path] = c.siteKey.split('/')
  const sub = host && SUBDOMAIN_PLATFORMS.some((d) => host !== d && hostIs(host, d)) ? [host.split('.')[0]] : []
  return [...sub, ...path.filter((p) => !['site', 'sites', 'pagina', 'empresa', 'perfil', 'clube', 'view', 'a'].includes(p))]
}

// URL-base a verificar/guardar para um achado: origem do site; em plataforma compartilhada por caminho, a página do negócio.
export function candidateBase(raw: string | null | undefined): string | null {
  const c = classifyUrl(raw)
  if (!c.url) return null
  if (c.kind === 'SHARED_PLATFORM_SITE' && c.siteKey?.includes('/')) return `https://${c.siteKey}`
  try { return new URL(c.url).origin } catch { return null }
}
