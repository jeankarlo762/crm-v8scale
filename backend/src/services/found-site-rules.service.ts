// Regras de aceitação para o que a BUSCA achou (foundWebsite / instagramHandle). Puras: usadas na
// extração, na fila e no reprocessamento. Nunca se aplicam ao websiteUri cadastrado pelo dono no Google
// (exceto a blocklist de plataformas, que já vive no classifyDomain).
import { UF_SIGLAS } from '../config/site-blocklist'
import {
  domainRelatesToBusiness, hasOtherStateLabel, isBlockedDomain, isCityGluedToOtherState, isInstitutionalDomain,
  isSocialHost, looksLikeAggregator,
} from './domain-classifier.service'
import { sharedSlugsOf, siteKeyOf } from './url-classify.service'

export type FoundSiteRejection =
  | 'rede_social' | 'bloqueio' | 'institucional' | 'agregador' | 'mesmo_site_google' | 'outro_estado' | 'sem_relacao'

export interface FoundSiteLead {
  arenaName: string
  city: string | null
  state: string | null
  website?: string | null // websiteUri do Google
  instagramHandle?: string | null
}

function fold(t: string): string {
  return t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

const STATE_NAMES: Record<string, string> = {
  acre: 'ac', alagoas: 'al', amapa: 'ap', amazonas: 'am', bahia: 'ba', ceara: 'ce', 'distrito federal': 'df', 'espirito santo': 'es',
  goias: 'go', maranhao: 'ma', 'mato grosso': 'mt', 'mato grosso do sul': 'ms', 'minas gerais': 'mg', para: 'pa', paraiba: 'pb',
  parana: 'pr', pernambuco: 'pe', piaui: 'pi', 'rio de janeiro': 'rj', 'rio grande do norte': 'rn', 'rio grande do sul': 'rs',
  rondonia: 'ro', roraima: 'rr', 'santa catarina': 'sc', 'sao paulo': 'sp', sergipe: 'se', tocantins: 'to',
}

// Sigla (SC) a partir da sigla ou do nome do estado.
export function ufOf(state: string | null): string | null {
  const s = fold(state ?? '').trim()
  if (/^[a-z]{2}$/.test(s)) return s
  return STATE_NAMES[s] ?? null
}

// O nome do negócio contém a cidade (ex.: "Pousada Laguna" em Laguna).
export function nameHasCity(leadName: string, city: string | null): boolean {
  const c = fold(city ?? '').trim()
  if (c.length < 3) return false
  return new RegExp(`(^|[^a-z0-9])${c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`).test(fold(leadName))
}

export function rejectFoundSite(url: string, lead: FoundSiteLead, opts: { allowUnrelated?: boolean } = {}): FoundSiteRejection | null {
  let host: string
  try {
    host = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname
  } catch {
    return 'sem_relacao'
  }
  const uf = ufOf(lead.state)
  if (isSocialHost(host)) return 'rede_social'
  if (isBlockedDomain(host) && !sharedSlugsOf(url).length) return 'bloqueio' // Google Sites (/view/<negócio>) é site DE um negócio, mesmo sob google.com
  if (isInstitutionalDomain(host)) return 'institucional'
  if (lead.website && siteKeyOf(url) && siteKeyOf(url) === siteKeyOf(lead.website)) return 'mesmo_site_google' // chave do SITE: plataforma compartilhada não colapsa por domínio
  if (hasOtherStateLabel(host, uf)) return 'outro_estado'
  if (looksLikeAggregator(host, lead.arenaName, lead.instagramHandle)) return 'agregador'
  if (nameHasCity(lead.arenaName, lead.city) && isCityGluedToOtherState(host, lead.city, uf)) return 'outro_estado'
  // Em plataforma compartilhada (wixsite, /site/<negócio>) o que identifica o negócio é o subdomínio/caminho, não o domínio.
  const slugs = sharedSlugsOf(url)
  const related = slugs.length ? slugs.some((s) => domainRelatesToBusiness(`${s}.com`, lead.arenaName, lead.instagramHandle)) : domainRelatesToBusiness(host, lead.arenaName, lead.instagramHandle)
  if (!opts.allowUnrelated && !related) return 'sem_relacao'
  return null
}

// @ achado que traz a sigla de outro estado colada à cidade do nome (ex.: pousadalagunapb).
export function rejectInstagramHandle(handle: string, lead: FoundSiteLead): 'outro_estado' | null {
  const uf = ufOf(lead.state)
  const slug = handle.toLowerCase().replace(/[^a-z0-9]/g, '')
  const city = fold(lead.city ?? '').replace(/[^a-z0-9]/g, '')
  if (!uf || city.length < 3 || !nameHasCity(lead.arenaName, lead.city)) return null
  return UF_SIGLAS.some((o) => o !== uf && slug.endsWith(`${city}${o}`)) ? 'outro_estado' : null
}
