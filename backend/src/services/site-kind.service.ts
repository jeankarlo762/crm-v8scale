// classifySite: tipo da URL cadastrada no Google (websiteUri). Puro, sem I/O.
// Reaproveita as listas de domínio do domain-classifier (configuráveis).
import { classifyDomain } from './domain-classifier.service'

export type SiteKind = 'sem_site' | 'so_instagram' | 'so_facebook' | 'link_bio' | 'so_ota' | 'site_proprio'

export interface SiteClassification {
  kind: SiteKind
  instagramHandle: string | null
}

const FACEBOOK_HOSTS = ['facebook.com', 'fb.com', 'fb.me']
const OTA_HOSTS = ['booking.com', 'airbnb', 'expedia', 'trivago', 'decolar', 'tripadvisor']
// Caminhos do Instagram que não são perfil.
const INSTAGRAM_NON_PROFILE = new Set(['p', 'reel', 'reels', 'explore', 'popular', 'stories', 'tv', 'accounts', 'share', 'direct'])

function parseUrl(raw: string): URL | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  try {
    return new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`)
  } catch {
    return null
  }
}

function bareHost(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, '')
}

function hostIs(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`)
}

export function isInstagramHost(hostname: string): boolean {
  return hostIs(bareHost(hostname), 'instagram.com')
}

// "https://www.instagram.com/baiuka.pousada/?hl=pt" -> "baiuka.pousada"; posts/reels/explore -> null.
export function extractInstagramHandle(uri: string): string | null {
  const url = parseUrl(uri)
  if (!url || !isInstagramHost(url.hostname)) return null
  const first = url.pathname.split('/').filter(Boolean)[0]?.toLowerCase()
  if (!first || INSTAGRAM_NON_PROFILE.has(first) || !/^[a-z0-9._]{1,30}$/.test(first)) return null
  return first
}

export function classifySite(uri: string | null | undefined): SiteClassification {
  const url = uri ? parseUrl(uri) : null
  if (!url) return { kind: 'sem_site', instagramHandle: null }
  const host = bareHost(url.hostname)

  if (isInstagramHost(host)) return { kind: 'so_instagram', instagramHandle: extractInstagramHandle(url.href) }
  if (FACEBOOK_HOSTS.some((d) => hostIs(host, d))) return { kind: 'so_facebook', instagramHandle: null }
  if (OTA_HOSTS.some((d) => host.split('.').includes(d.replace(/\..*$/, '')))) return { kind: 'so_ota', instagramHandle: null }

  const category = classifyDomain(host)
  // Demais redes sociais (tiktok, youtube, wa.me...) e agregadores de links caem em "link na bio".
  if (category === 'link_na_bio' || category === 'rede_social') return { kind: 'link_bio', instagramHandle: null }
  // Outras plataformas (encurtadores, perfis do Google, guias de turismo) não são site próprio.
  if (category === 'plataforma') return { kind: 'so_ota', instagramHandle: null }
  return { kind: 'site_proprio', instagramHandle: null }
}
