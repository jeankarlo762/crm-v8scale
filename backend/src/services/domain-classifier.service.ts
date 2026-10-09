import { getDomain } from 'tldts'
import { BLOCKED_DOMAINS, GENERIC_TRAVEL_TERMS, INSTITUTIONAL_DOMAINS, UF_SIGLAS } from '../config/site-blocklist'

// Classifica um domínio em uma das 4 categorias da presença digital. Puro e
// testável — sem I/O. As listas são configuráveis (arrays exportados).
export type DomainCategory = 'rede_social' | 'link_na_bio' | 'plataforma' | 'candidato'

export const REDE_SOCIAL_DOMAINS = [
  'instagram.com', 'facebook.com', 'fb.com', 'fb.me', 'tiktok.com', 'youtube.com', 'youtu.be',
  'fb.watch', 'wa.me', 'wa.link', 'api.whatsapp.com', 'whatsapp.com', 't.me', 'telegram.me', 'twitter.com', 'x.com',
  'linkedin.com', 'pinterest.com', 'kwai.com',
]

export const LINK_NA_BIO_DOMAINS = [
  'linktr.ee', 'beacons.ai', 'bio.link', 'lnk.bio', 'taplink.cc', 'linkin.bio', 'campsite.bio',
  'msha.ke', 'bio.site', 'allmylinks.com', 'solo.to', 'hoo.be', 'linkme.bio', 'carrd.co',
  'linkpop.com', 'linke.to',
]

// Agregadores/plataformas onde o negócio tem página, mas não é site próprio.
// Suporta padrões com "*" (glob simples) para famílias de domínio.
export const PLATAFORMA_DOMAINS = [
  'booking.com', 'airbnb.*', 'trivago.*', 'tripadvisor.*', 'decolar.com', 'expedia.*',
  'hoteis.com', 'ifood.com.br', 'doctoralia.com.br', 'agendor.com.br', 'solutudo.com.br',
  'pousada.biz', '*.hotelsantacatarina.com', '*.hoteis-em-suldobrasil.com',
  // encurtadores genéricos — não são site próprio nem se enquadram nas outras categorias
  'bit.ly', 'tinyurl.com', 'goo.gl', 'is.gd', 'cutt.ly', 'rb.gy', 'ow.ly', 't.co', 'tiny.cc', 'shorturl.at',
  // perfis do próprio Google — não são site próprio
  'business.site', 'g.page', 'maps.app.goo.gl', 'google.com',
]

function normalizeHost(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, '')
}

// "*.foo.com" vira /^([a-z0-9-]+\.)*foo\.com$/; "foo.*" vira /^foo\.[a-z]+$/
function globToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('[a-z0-9.-]*')
  return new RegExp(`^${escaped}$`)
}

// Casa o host ou qualquer domínio-pai dele (subdomínios de domínio bloqueado também valem).
function matchesList(host: string, list: string[]): boolean {
  const labels = host.split('.')
  const candidates = labels.map((_, i) => labels.slice(i).join('.'))
  return list.some((d) => {
    const re = d.includes('*') ? globToRegExp(d) : null
    return candidates.some((c) => (re ? re.test(c) : c === d))
  })
}

export function classifyDomain(hostname: string): DomainCategory {
  const host = normalizeHost(hostname)
  if (matchesList(host, REDE_SOCIAL_DOMAINS)) return 'rede_social'
  if (matchesList(host, LINK_NA_BIO_DOMAINS)) return 'link_na_bio'
  if (matchesList(host, PLATAFORMA_DOMAINS)) return 'plataforma'
  if (isBlockedDomain(host)) return 'plataforma'
  return 'candidato'
}

// Domínio da lista de bloqueio (diretório, guia, OTA, mapa, notícia): nunca é site próprio.
export function isBlockedDomain(hostname: string): boolean {
  return matchesList(normalizeHost(hostname), BLOCKED_DOMAINS)
}

// Rede social/WhatsApp: nunca passa pelo health check como site próprio.
export function isSocialHost(hostname: string): boolean {
  return matchesList(normalizeHost(hostname), REDE_SOCIAL_DOMAINS)
}

// Palavras genéricas de segmento — removidas antes de comparar nome↔domínio.
const GENERIC_WORDS = new Set([
  'pousada', 'hotel', 'hostel', 'clinica', 'clínica', 'restaurante', 'academia', 'arena',
  'sc', 'sp', 'rs', 'pr', 'condominio', 'apart', 'chale', 'chales', 'flat', 'flats', 'suite', 'suites',
  'estudio', 'estúdio', 'salao', 'salão', 'espaco', 'espaço', 'quadra', 'quadras',
  'de', 'do', 'da', 'dos', 'das', 'e', 'em', 'the', 'and',
])

// "Baiuka Pousada" -> ["baiuka"]; remove acento, minúsculas, tira genéricas.
export function normalizeNameTokens(name: string): string[] {
  const normalized = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
  return normalized
    .split(/\s+/)
    .filter(Boolean)
    .filter((w) => !GENERIC_WORDS.has(w))
}

// Domínio "bate" com o nome quando algum token significativo do nome aparece
// no domínio (sem acento/pontuação) — ex: "baiuka" em "baiukapousada.com.br".
export function nameMatchesDomain(name: string, hostname: string): boolean {
  const tokens = normalizeNameTokens(name)
  if (tokens.length === 0) return false
  const domainSlug = normalizeHost(hostname).replace(/\.[a-z.]+$/, '').replace(/[^a-z0-9]/g, '')
  return tokens.some((t) => t.length >= 3 && domainSlug.includes(t))
}

// Domínio registrável (eTLD+1): "x.hotels-brazil.net" -> "hotels-brazil.net".
export function registrableDomain(hostname: string): string {
  const host = normalizeHost(hostname)
  return getDomain(host) ?? host
}

function slugOf(hostname: string): string {
  return registrableDomain(hostname).replace(/\.[a-z.]+$/, '').replace(/[^a-z0-9]/g, '')
}

// O token do nome precisa aparecer no slug como palavra, não solto no meio de outra: o que vem antes dele
// deve ser nada, uma palavra genérica (pousada, arena, sc...) ou algo com 3+ letras. Letra(s) solta(s) coladas
// antes ("a"+"tribo" = "atribo" pra "Arena Tribo") são coincidência de substring, não relação com o negócio.
function tokenInSlug(slug: string, token: string): boolean {
  for (let i = slug.indexOf(token); i !== -1; i = slug.indexOf(token, i + 1)) {
    const before = slug.slice(0, i)
    if (before === '' || before.length >= 3 || GENERIC_WORDS.has(before)) return true
  }
  return false
}

// O domínio contido no @ (ex.: "arenashark" em "arenasharkoficial") só vale se for o começo do @ ou cobrir a
// maior parte dele; senão qualquer domínio curto que caia no meio do @ por acaso passaria ("atribo" em "arenatribo").
function slugCoversHandle(slug: string, handle: string): boolean {
  if (slug.length < 5 || !handle.includes(slug)) return false
  return handle.startsWith(slug) || slug.length / handle.length >= 0.7
}

// Regra de similaridade: só o domínio registrável é comparado (nunca subdomínio/caminho) e TODOS os
// tokens distintivos do nome precisam bater — ou então o @ do Instagram.
export function domainRelatesToBusiness(hostname: string, name: string, handle?: string | null): boolean {
  const slug = slugOf(hostname)
  if (!slug) return false
  const tokens = normalizeNameTokens(name).filter((t) => t.length >= 2)
  if (tokens.length > 0 && tokens.every((t) => tokenInSlug(slug, t))) return true
  if (handle) {
    const hs = handle.toLowerCase().replace(/[^a-z0-9]/g, '')
    const core = normalizeNameTokens(handle.replace(/[._]/g, ' ')).join('')
    if (hs.length >= 4 && (slug.includes(hs) || slugCoversHandle(slug, hs))) return true
    if (core.length >= 4 && (slug.includes(core) || slugCoversHandle(slug, core))) return true
  }
  return false
}

// Domínio registrável genérico de hospedagem/viagem, sem relação com o negócio = agregador (plataforma).
export function looksLikeAggregator(hostname: string, name: string, handle?: string | null): boolean {
  const slug = slugOf(hostname)
  return GENERIC_TRAVEL_TERMS.some((t) => slug.includes(t)) && !domainRelatesToBusiness(hostname, name, handle)
}

export function isInstitutionalDomain(hostname: string): boolean {
  return matchesList(normalizeHost(hostname), INSTITUTIONAL_DOMAINS)
}

function hostnameOf(urlOrHost: string): string | null {
  try {
    return new URL(/^https?:\/\//i.test(urlOrHost.trim()) ? urlOrHost.trim() : `https://${urlOrHost.trim()}`).hostname
  } catch {
    return null
  }
}

// Mesmo site? Compara o domínio registrável (eTLD+1), ignorando protocolo, www e subdomínio.
export function sameRegistrableDomain(a: string | null | undefined, b: string | null | undefined): boolean {
  const ha = a ? hostnameOf(a) : null
  const hb = b ? hostnameOf(b) : null
  return !!ha && !!hb && registrableDomain(ha) === registrableDomain(hb)
}

// Sigla de outro estado como rótulo do domínio (ex.: "santaterezinha.mt.gov.br" para um lead de SC).
export function hasOtherStateLabel(hostname: string, ownUf: string | null): boolean {
  if (!ownUf) return false
  const labels = normalizeHost(hostname).split('.')
  return labels.slice(1, -1).some((l) => UF_SIGLAS.includes(l) && l !== ownUf.toLowerCase())
}

// Sigla de outro estado colada à cidade no domínio (ex.: "pousadalagunapb.com.br" em Laguna/SC).
export function isCityGluedToOtherState(hostname: string, city: string | null, ownUf: string | null): boolean {
  const c = (city ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')
  if (!ownUf || c.length < 3) return false
  const slug = slugOf(hostname)
  return UF_SIGLAS.some((uf) => uf !== ownUf.toLowerCase() && slug.endsWith(`${c}${uf}`))
}
