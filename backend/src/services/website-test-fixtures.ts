// Fixtures compartilhadas pelos testes da investigação (sem rede, sem banco). Não é importado em produção.
import { extractPageFacts, FACTS_VERSION } from './page-facts.service'
import { dependsOnHash, googleEvidenceRow, type EvidenceRow } from './lead-evidence.service'
import { GOOGLE_COLLECTION_VERSION } from './website-types'
import { queryFor, type ResolveLead, type ResolveOptions } from './website-resolve.service'
import { fold } from './contact-normalize'

export const LEAD: ResolveLead = {
  arenaName: 'Arena Tribo', city: 'Tubarão', state: 'SC', address: 'R. das Flores, 123 - Centro, Tubarão - SC, 88700-000, Brasil',
  phoneE164: '+5548991234567', whatsapp: '(48) 99123-4567', placeId: 'place-1', website: null, foundWebsite: null,
  instagramHandle: null, instagramVerificar: false, instagramManual: false, siteManual: false,
}

export const OPTS: ResolveOptions = { dependsOn: dependsOnHash(LEAD), tavilyConfigured: true, metaConfigured: false }
export const opts = (over: Partial<ResolveOptions> = {}, lead: ResolveLead = LEAD): ResolveOptions => ({ ...OPTS, dependsOn: dependsOnHash(lead), ...over })

const filler = '<p>' + 'Quadras de beach tennis, futevôlei e vôlei de areia para toda a família, aulas e torneios o ano todo. '.repeat(4) + '</p>'
export function html(title: string, body = '', ld = ''): string {
  return `<html><head><title>${title}</title>${ld}</head><body>${filler}${body}</body></html>`
}
export const ldBusiness = (name: string, city: string, tel: string, street = 'Av. Central, 10') =>
  `<script type="application/ld+json">{"@type":"LocalBusiness","name":"${name}","telephone":"${tel}","address":{"streetAddress":"${street}","addressLocality":"${city}","addressRegion":"SC"}}</script>`

// Página DO lead (telefone em tel: + nome no título) / de outra empresa / bloqueada / sem informação.
export const OWN_PAGE = html('Arena Tribo | Beach Tennis', '<a href="tel:+5548991234567">ligue</a>')
export const OTHER_COMPANY_PAGE = html('Hotel Beta Palace', '<a href="tel:+554832221111">x</a>', ldBusiness('Hotel Beta Palace', 'Tubarão', '+554832221111'))
export const VAGUE_PAGE = html('Home', '<p>Bem-vindo</p>')

export function factsRow(url: string, htmlText: string, over: { finalUrl?: string; httpStatus?: number | null; blocked?: boolean; health?: string; collectedAt?: Date; fromCache?: boolean } = {}): EvidenceRow {
  const f = extractPageFacts({ url, finalUrl: over.finalUrl ?? url, html: htmlText, httpStatus: over.httpStatus === undefined ? 200 : over.httpStatus, blocked: over.blocked, health: over.health ?? 'ok' })
  return { source: 'WEBSITE', type: 'PAGE_FACTS', key: url, value: f, outcome: f.evaluable ? 'OK' : 'UNEVALUABLE', fromCache: over.fromCache ?? false, collectedAt: over.collectedAt ?? new Date(), dependsOn: '', version: FACTS_VERSION }
}

export function searchRow(kind: 'NAME' | 'PHONE' | 'HANDLE' | 'ADDRESS' | 'INSTAGRAM', results: { title: string; url: string; content: string }[] = [], over: { lead?: ResolveLead; collectedAt?: Date; fromCache?: boolean; handle?: string | null } = {}): EvidenceRow {
  const lead = over.lead ?? LEAD
  const query = queryFor(kind, lead, over.handle ?? lead.instagramHandle) as string
  return {
    source: 'TAVILY', type: 'SEARCH_RESULTS', key: fold(query).replace(/\s+/g, ' ').trim(), value: { kind, query, results },
    outcome: results.length ? 'OK' : 'EMPTY', fromCache: over.fromCache ?? false, collectedAt: over.collectedAt ?? new Date(), dependsOn: dependsOnHash(lead), version: '',
  }
}

export function bioRow(handle: string, v: { found?: boolean; website?: string | null; biography?: string | null; username?: string | null } = {}, over: { lead?: ResolveLead; collectedAt?: Date } = {}): EvidenceRow {
  const found = v.found ?? true
  return { source: 'META', type: 'IG_BIO', key: handle.toLowerCase(), value: { found, website: v.website ?? null, biography: v.biography ?? null, username: v.username ?? handle }, outcome: found ? 'OK' : 'NOT_FOUND', fromCache: false, collectedAt: over.collectedAt ?? new Date(), dependsOn: dependsOnHash(over.lead ?? LEAD), version: '' }
}

// Resultado de busca "limpo" de uma empresa com site próprio relacionado ao nome.
export const hit = (url: string, title = 'Arena Tribo', content = 'Arena Tribo em Tubarão SC, quadras de beach tennis') => ({ title, url, content })
export const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000)

// Evidência da coleta do Google (campo websiteUri consultado). Sem ela, placeId sozinho NÃO conta como "Google consultado".
export const googleRow = (over: { lead?: ResolveLead; websiteUri?: string | null; collectedAt?: Date; fromCache?: boolean; version?: string } = {}): EvidenceRow =>
  googleEvidenceRow({ placeId: (over.lead ?? LEAD).placeId as string, websiteUri: over.websiteUri ?? null, collection: over.version ?? GOOGLE_COLLECTION_VERSION, collectedAt: over.collectedAt ?? new Date(), fromCache: over.fromCache ?? false })
