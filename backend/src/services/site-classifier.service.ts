// Classifica a presença digital de um lead a partir do websiteUri do Places:
// domínio -> (se link-na-bio) extrai links de saída -> valida candidato.
// Sem fallback de busca (SERP) — só o que dá pra resolver a partir do Places.
import { classifyDomain, isBlockedDomain, isSocialHost, nameMatchesDomain } from './domain-classifier.service'
import { classifySite, extractInstagramHandle, type SiteKind } from './site-kind.service'
import { assertPublicHost, readTextLimited } from './safe-network'
import { htmlToText } from './website-identity.service'
import { extractPageFacts, type PageFacts } from './page-facts.service'
import { checkSiteHealth, isPrivateHost, parseSiteUrl as parseUrl, type SiteHealth } from './site-health.service'

export type StatusSite = SiteKind | 'fora_do_ar' | 'sem_https' | 'certificado_invalido' | 'verificar'

export interface LinksEncontrados {
  instagram?: string
  whatsapp?: string
  linktree?: string
  booking?: string
  outros?: string[]
}

export interface ClassificacaoSite {
  status: StatusSite
  siteUrl: string | null
  linksEncontrados: LinksEncontrados
  fonte: 'maps' | 'linktree' | null
  siteStatus: SiteHealth | null
  siteCheckReason?: string | null
  instagramHandle: string | null
  // Site próprio achado dentro de uma página de link na bio (sem gastar busca).
  foundWebsite?: string | null
  foundSiteStatus?: SiteHealth | null
  foundSiteCheckReason?: string | null
  foundSource?: 'link_na_bio' | null
  // Texto da página do site do Google (já baixada no health check; nada extra é buscado) — base da verificação de identidade.
  pageText?: string
  // Fatos da MESMA resposta do health check (reaproveitados pela identidade: nenhum 2º download).
  pageFacts?: PageFacts
}

const REQUEST_TIMEOUT_MS = 8000

// GET com redirects seguidos na mão (máx. 5), barrando host privado a cada salto (SSRF).
async function safeFetch(url: string): Promise<Response | null> {
  try {
    let current = new URL(url)
    for (let hop = 0; hop <= 5; hop++) {
      if (isPrivateHost(current.hostname) || !(await assertPublicHost(current.hostname))) return null
      const res = await fetch(current.href, {
        method: 'GET',
        redirect: 'manual',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; V8ScaleBot/1.0)' },
      })
      const location = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null
      if (!location) return Object.defineProperty(res, 'url', { value: current.href })
      current = new URL(location, current)
    }
    return null
  } catch {
    return null
  }
}

function onlyDigits(v: string): string {
  return v.replace(/\D/g, '')
}

function isInstagramHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^www\./, '')
  return h === 'instagram.com' || h.endsWith('.instagram.com')
}

function isWhatsappHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^www\./, '')
  return h === 'wa.me' || h === 'whatsapp.com' || h.endsWith('.whatsapp.com')
}

function isBookingHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^www\./, '')
  return h === 'booking.com' || h.endsWith('.booking.com')
}

// Hosts de fontes/CDN que aparecem em <link href> da página, nunca são links da bio.
const ASSET_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com', 'gstatic.com', 'googletagmanager.com', 'google-analytics.com', 'cloudflare.com', 'cdnjs.cloudflare.com', 'jsdelivr.net', 'unpkg.com']
function isAssetHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^www\./, '')
  return ASSET_HOSTS.some((d) => h === d || h.endsWith(`.${d}`))
}

function addLink(links: LinksEncontrados, url: URL) {
  if (isInstagramHost(url.hostname)) links.instagram = url.href
  else if (isWhatsappHost(url.hostname)) links.whatsapp = url.href
  else if (url.hostname.replace(/^www\./, '') === 'linktr.ee') links.linktree = url.href
  else if (isBookingHost(url.hostname)) links.booking = url.href
  else (links.outros ??= []).push(url.href)
}

// Busca a página de um link-na-bio (ex.: Linktree) e extrai todos os links
// de saída, classificando cada um pela mesma regra de domínio.
async function extractLinksFromBioPage(bioUrl: string): Promise<{ links: LinksEncontrados; candidatos: URL[] }> {
  const links: LinksEncontrados = {}
  const candidatos: URL[] = []
  const res = await safeFetch(bioUrl)
  if (!res || !res.ok) return { links, candidatos }
  const html = await readTextLimited(res)
  const hrefs = [...html.matchAll(/href=["']([^"']+)["']/gi)].map((m) => m[1])
  const seen = new Set<string>()
  for (const href of hrefs) {
    const url = parseUrl(href)
    if (!url || isPrivateHost(url.hostname) || isAssetHost(url.hostname) || seen.has(url.href)) continue
    seen.add(url.href)
    addLink(links, url)
    if (classifyDomain(url.hostname) === 'candidato') candidatos.push(url)
  }
  return { links, candidatos }
}

// Health check do candidato + checagem de que o site é do negócio (nome no
// domínio/HTML ou telefone no HTML). Site que não bate com o negócio vira "verificar".
async function validateCandidate(
  url: URL,
  leadName: string,
  leadPhone: string | null,
): Promise<{ status: 'site_proprio' | 'fora_do_ar' | 'verificar'; siteStatus: SiteHealth; finalUrl: string; reason: string | null; pageText: string; pageFacts?: PageFacts }> {
  // Rede social/diretório nunca passa pelo health check como site próprio.
  if (isSocialHost(url.hostname) || isBlockedDomain(url.hostname)) return { status: 'verificar', siteStatus: 'ok', finalUrl: url.href, reason: null, pageText: '' }
  const health = await checkSiteHealth(url.href)
  const pageFacts = extractPageFacts({ url: url.href, finalUrl: health.finalUrl, html: health.html, httpStatus: health.httpStatus ?? (health.html ? 200 : null), blocked: health.blocked, health: health.status })
  if (health.status === 'fora_do_ar' || health.status === 'dominio_parado') {
    return { status: 'fora_do_ar', siteStatus: health.status, finalUrl: health.finalUrl, reason: health.reason, pageText: '', pageFacts }
  }
  // sem_https/certificado_invalido seguem o fluxo abaixo (o site existe); o problema fica só em siteStatus/reason.

  const finalHost = new URL(health.finalUrl).hostname
  const digitsPhone = leadPhone ? onlyDigits(leadPhone) : ''
  const htmlLower = health.html.toLowerCase()
  const nameTokenMatch = nameMatchesDomain(leadName, finalHost)
  const nameInHtml = leadName
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length >= 4)
    .some((w) => htmlLower.includes(w))
  const phoneInHtml = digitsPhone.length >= 8 && onlyDigits(health.html).includes(digitsPhone)

  const own = nameTokenMatch || nameInHtml || phoneInHtml
  return { status: own ? 'site_proprio' : 'verificar', siteStatus: health.status, finalUrl: health.finalUrl, reason: health.reason, pageText: htmlToText(health.html, 60_000), pageFacts }
}

const KIND_STATUS: Partial<Record<SiteKind, StatusSite>> = {
  so_instagram: 'so_instagram', so_facebook: 'so_facebook', so_ota: 'so_ota', link_bio: 'link_bio',
}

const SHORTENER_HOSTS = ['bit.ly', 'tinyurl.com', 'cutt.ly', 'encurtador.com.br', 'goo.gl', 'is.gd', 'rb.gy', 'ow.ly', 't.co', 'tiny.cc', 'shorturl.at', 'linkr.bio']

function isShortener(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^www\./, '')
  return SHORTENER_HOSTS.some((d) => h === d || h.endsWith(`.${d}`))
}

// Encurtador: GET seguindo redirects (8s) e classifica pelo destino final.
async function resolveShortener(url: URL): Promise<URL> {
  if (!isShortener(url.hostname) || isPrivateHost(url.hostname)) return url
  const res = await safeFetch(url.href)
  if (!res?.url) return url
  try {
    const final = new URL(res.url)
    return isPrivateHost(final.hostname) ? url : final
  } catch {
    return url
  }
}

// Página de link na bio: baixa o HTML, extrai os links e valida o primeiro
// domínio próprio (não rede social/WhatsApp/OTA). Nunca acessa instagram.com.
export async function findOwnSiteInBio(bioUrl: string, leadName: string, leadPhone: string | null) {
  const bio = await extractLinksFromBioPage(bioUrl)
  if (bio.candidatos.length === 0) return { links: bio.links, site: null }
  const v = await validateCandidate(bio.candidatos[0], leadName, leadPhone)
  return { links: bio.links, site: { url: v.finalUrl, health: v.siteStatus, reason: v.reason } }
}

// Orquestra a classificação de presença digital de um lead a partir do
// websiteUri do Places (encurtador -> classifySite -> link na bio -> health
// check). A busca web por Instagram/site fica no enriquecimento.
export async function classifyPresencaDigital(
  website: string | null | undefined,
  leadName: string,
  leadPhone: string | null,
): Promise<ClassificacaoSite> {
  const base = { linksEncontrados: {} as LinksEncontrados, siteStatus: null, instagramHandle: null }
  const parsed = website ? parseUrl(website) : null
  if (!parsed) return { ...base, status: 'sem_site', siteUrl: null, fonte: null }
  const url = await resolveShortener(parsed)

  const { kind, instagramHandle } = classifySite(url.href)
  if (kind === 'link_bio') {
    const links: LinksEncontrados = {}
    addLink(links, url)
    if (classifyDomain(url.hostname) !== 'link_na_bio') return { ...base, linksEncontrados: links, status: 'link_bio', siteUrl: url.href, fonte: 'maps' }
    const { links: found, site } = await findOwnSiteInBio(url.href, leadName, leadPhone)
    Object.assign(links, found)
    return {
      ...base,
      linksEncontrados: links,
      status: 'link_bio',
      siteUrl: url.href,
      fonte: 'linktree',
      instagramHandle: found.instagram ? extractInstagramHandle(found.instagram) : null,
      foundWebsite: site?.url ?? null,
      foundSiteStatus: site?.health ?? null,
      foundSiteCheckReason: site?.reason ?? null,
      foundSource: site ? 'link_na_bio' : null,
    }
  }

  const simple = KIND_STATUS[kind]
  if (simple) {
    addLink(base.linksEncontrados, url)
    return { ...base, status: simple, siteUrl: url.href, fonte: 'maps', instagramHandle }
  }

  // kind === 'site_proprio' — website próprio direto no Places (ou destino do encurtador).
  const validated = await validateCandidate(url, leadName, leadPhone)
  return {
    ...base,
    status: validated.status,
    siteStatus: validated.siteStatus,
    siteCheckReason: validated.reason,
    siteUrl: validated.status === 'fora_do_ar' ? url.href : validated.finalUrl,
    fonte: 'maps',
    pageText: validated.pageText,
    pageFacts: validated.pageFacts,
  }
}

// Página de link na bio (1 nível): hrefs de saída (sem CDN/assets) + @ do Instagram, com SSRF/limites do safeFetch.
// ok=false quando a página não pôde ser lida (não prova ausência de nada).
export async function fetchPageHrefs(pageUrl: string): Promise<{ ok: boolean; links: string[]; instagram: string | null }> {
  const res = await safeFetch(pageUrl)
  if (!res || !res.ok) return { ok: false, links: [], instagram: null }
  const html = await readTextLimited(res)
  if (!html) return { ok: false, links: [], instagram: null }
  const links: string[] = []
  let instagram: string | null = null
  const seen = new Set<string>()
  for (const m of html.matchAll(/href=["']([^"']+)["']/gi)) {
    const url = parseUrl(m[1])
    if (!url || isPrivateHost(url.hostname) || isAssetHost(url.hostname) || seen.has(url.href)) continue
    seen.add(url.href)
    if (isInstagramHost(url.hostname)) instagram ??= extractInstagramHandle(url.href)
    else if (links.length < 40) links.push(url.href)
  }
  return { ok: true, links, instagram }
}
