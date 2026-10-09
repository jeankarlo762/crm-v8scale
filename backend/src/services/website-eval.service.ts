// Rotina de AVALIAÇÃO da classificação "tem site?": roda exemplos ROTULADOS (verdade: tem / não tem site) pelo mesmo
// caminho da produção, só com evidências armazenadas (sem rede), e calcula as métricas pedidas. Nenhum número aqui é
// inventado: sem rótulos não há métrica. Com poucos exemplos o intervalo de confiança (Wilson 95%) fica largo — olhe-o.
//
// Caso rotulado = { id, lead, rows|shorthand, truth }. Os mesmos casos servem de conjunto de regressão (ouro) e podem ser
// exportados da base real (prisma/eval-website-decision.ts --export-sample) para você rotular à mão.
import { extractPageFacts, FACTS_VERSION } from './page-facts.service'
import { dependsOnHash, googleEvidenceRow, type EvidenceRow } from './lead-evidence.service'
import { queryFor, resolveFromEvidence, type ResolveLead, type Resolution } from './website-resolve.service'
import { fold } from './contact-normalize'
import { GOOGLE_COLLECTION_VERSION, type WebsiteStatus } from './website-types'

export type Truth = 'HAS_WEBSITE' | 'NO_WEBSITE' // NO_WEBSITE inclui "só rede social"

export type ShorthandRow =
  | { page: string; html?: string; status?: number | null; blocked?: boolean; finalUrl?: string; health?: string }
  | { search: 'NAME' | 'PHONE' | 'HANDLE' | 'ADDRESS' | 'INSTAGRAM'; results?: { title: string; url: string; content: string }[] }
  | { google: true; website?: string | null } // coleta do Google COM o campo websiteUri consultado (placeId sozinho não prova nada)
  | { bio: string; found?: boolean; website?: string | null; biography?: string | null }
  | { link: string; links: string[]; instagram?: string | null; ok?: boolean }
  | { row: Omit<EvidenceRow, 'collectedAt'> & { collectedAt: string } }

export interface EvalCase {
  id: string
  synthetic?: boolean // exemplo escrito à mão para testar a rotina: NÃO mede desempenho real
  note?: string
  lead: ResolveLead
  rows: ShorthandRow[]
  truth: Truth | null // null = ainda sem rótulo (ignorado nas métricas)
  calls?: { tavily?: number; meta?: number } // consumo real do lead (se conhecido) para "consumo por lead resolvido"
  exhausted?: boolean // investigação terminou? (padrão true: o caso representa o estado final)
}

export function buildRows(c: EvalCase): EvidenceRow[] {
  const dep = dependsOnHash(c.lead)
  const now = new Date()
  return c.rows.map((r): EvidenceRow => {
    if ('row' in r) return { ...r.row, collectedAt: new Date(r.row.collectedAt) }
    if ('page' in r) {
      const f = extractPageFacts({ url: r.page, finalUrl: r.finalUrl ?? r.page, html: r.html ?? '', httpStatus: r.status === undefined ? 200 : r.status, blocked: r.blocked, health: r.health ?? 'ok' })
      return { source: 'WEBSITE', type: 'PAGE_FACTS', key: r.page, value: f, outcome: f.evaluable ? 'OK' : 'UNEVALUABLE', fromCache: false, collectedAt: now, dependsOn: '', version: FACTS_VERSION }
    }
    if ('google' in r) return googleEvidenceRow({ placeId: c.lead.placeId ?? 'sem-placeid', websiteUri: r.website ?? null, collection: GOOGLE_COLLECTION_VERSION, collectedAt: now, fromCache: false })
    if ('search' in r) {
      const q = queryFor(r.search, c.lead, c.lead.instagramHandle) as string
      const results = r.results ?? []
      return { source: 'TAVILY', type: 'SEARCH_RESULTS', key: fold(q).replace(/\s+/g, ' ').trim(), value: { kind: r.search, query: q, results }, outcome: results.length ? 'OK' : 'EMPTY', fromCache: false, collectedAt: now, dependsOn: dep, version: '' }
    }
    if ('bio' in r) {
      const found = r.found ?? true
      return { source: 'META', type: 'IG_BIO', key: r.bio.replace(/^@/, '').toLowerCase(), value: { found, website: r.website ?? null, biography: r.biography ?? null, username: r.bio.replace(/^@/, '') }, outcome: found ? 'OK' : 'NOT_FOUND', fromCache: false, collectedAt: now, dependsOn: dep, version: '' }
    }
    return { source: 'WEBSITE', type: 'LINK_PAGE', key: r.link, value: { ok: r.ok ?? true, links: r.links, instagram: r.instagram ?? null }, outcome: r.ok === false ? 'UNREADABLE' : 'OK', fromCache: false, collectedAt: now, dependsOn: '', version: FACTS_VERSION }
  })
}

export interface Prediction { id: string; status: WebsiteStatus; reason: string; truth: Truth | null; confidence: number; calls: number | null; synthetic: boolean }

export function predict(c: EvalCase, opts: { tavilyConfigured?: boolean; metaConfigured?: boolean } = {}): { prediction: Prediction; resolution: Resolution } {
  const resolution = resolveFromEvidence(c.lead, buildRows(c), { dependsOn: dependsOnHash(c.lead), tavilyConfigured: opts.tavilyConfigured ?? true, metaConfigured: opts.metaConfigured ?? true, exhausted: c.exhausted ?? true })
  const d = resolution.decision
  return { resolution, prediction: { id: c.id, status: d.status, reason: d.primaryReason, truth: c.truth, confidence: d.confidence, calls: c.calls ? (c.calls.tavily ?? 0) + (c.calls.meta ?? 0) : null, synthetic: !!c.synthetic } }
}

// ── Métricas ───────────────────────────────────────────────────────────────────────────────────

export interface Rate { num: number; den: number; rate: number | null; ci95: [number, number] | null }

// Intervalo de Wilson 95%: honesto com amostras pequenas.
export function wilson(num: number, den: number, z = 1.96): [number, number] | null {
  if (den === 0) return null
  const p = num / den
  const d = 1 + (z * z) / den
  const c = p + (z * z) / (2 * den)
  const m = z * Math.sqrt((p * (1 - p)) / den + (z * z) / (4 * den * den))
  return [Math.max(0, (c - m) / d), Math.min(1, (c + m) / d)]
}
const rate = (num: number, den: number): Rate => ({ num, den, rate: den === 0 ? null : num / den, ci95: wilson(num, den) })

const SAYS_HAS = (s: WebsiteStatus) => s === 'HAS_WEBSITE'
const SAYS_NO = (s: WebsiteStatus) => s === 'PROBABLY_NO_WEBSITE' || s === 'SOCIAL_ONLY'

export interface Metrics {
  total: number
  labeled: number
  note: string
  // pedidos explícitos
  falsePositiveSite: Rate // disse TEM site, a verdade é NÃO ter (entre os que disse "tem")
  falseNoSite: Rate // disse SEM site, a verdade é TER site (entre os liberados p/ abordagem) — o erro que mais custa
  autoResolved: Rate // decididos sem humano (HAS / PROBABLY_NO / SOCIAL_ONLY) sobre o total
  manualReview: Rate // UNKNOWN + CONFLICT sobre o total
  callsPerResolved: { calls: number; resolved: number; perResolved: number | null; leadsWithCallData: number }
  // extras
  releasedPrecision: Rate // dos liberados como "sem site", quantos realmente não têm (1 − falseNoSite)
  recallNoSite: Rate // dos que realmente não têm site, quantos foram liberados
  confusion: Record<string, Record<string, number>> // verdade → decisão
  byReason: Record<string, number>
}

export function computeMetrics(preds: Prediction[]): Metrics {
  const labeled = preds.filter((p) => p.truth)
  const says = (f: (s: WebsiteStatus) => boolean) => labeled.filter((p) => f(p.status))
  const saysHas = says(SAYS_HAS), saysNo = says(SAYS_NO)
  const confusion: Metrics['confusion'] = {}
  for (const p of labeled) { const row = (confusion[p.truth as string] ??= {}); row[p.status] = (row[p.status] ?? 0) + 1 }
  const byReason: Record<string, number> = {}
  for (const p of preds) byReason[p.reason] = (byReason[p.reason] ?? 0) + 1
  const resolved = preds.filter((p) => SAYS_HAS(p.status) || SAYS_NO(p.status))
  const withCalls = resolved.filter((p) => p.calls != null)
  const calls = withCalls.reduce((a, p) => a + (p.calls ?? 0), 0)
  const trulyNo = labeled.filter((p) => p.truth === 'NO_WEBSITE')
  const falseNo = saysNo.filter((p) => p.truth === 'HAS_WEBSITE').length
  return {
    total: preds.length,
    labeled: labeled.length,
    note: labeled.length === 0 ? 'Sem rótulos: nenhuma métrica de acerto foi calculada.' : 'Heurísticas não calibradas; confira os intervalos de confiança (amostras pequenas).',
    falsePositiveSite: rate(saysHas.filter((p) => p.truth === 'NO_WEBSITE').length, saysHas.length),
    falseNoSite: rate(falseNo, saysNo.length),
    autoResolved: rate(resolved.length, preds.length),
    manualReview: rate(preds.filter((p) => p.status === 'UNKNOWN' || p.status === 'CONFLICT').length, preds.length),
    callsPerResolved: { calls, resolved: withCalls.length, perResolved: withCalls.length ? calls / withCalls.length : null, leadsWithCallData: withCalls.length },
    releasedPrecision: rate(saysNo.length - falseNo, saysNo.length),
    recallNoSite: rate(trulyNo.filter((p) => SAYS_NO(p.status)).length, trulyNo.length),
    confusion, byReason,
  }
}

export function evaluate(cases: EvalCase[], opts: { tavilyConfigured?: boolean; metaConfigured?: boolean } = {}) {
  const results = cases.map((c) => ({ case: c, ...predict(c, opts) }))
  const preds = results.map((r) => r.prediction)
  return { results, metrics: computeMetrics(preds), syntheticOnly: preds.length > 0 && preds.every((p) => p.synthetic) }
}

export const fmtRate = (r: Rate): string => (r.rate == null ? 'n/d' : `${(r.rate * 100).toFixed(1)}% (${r.num}/${r.den}${r.ci95 ? `, IC95% ${(r.ci95[0] * 100).toFixed(0)}–${(r.ci95[1] * 100).toFixed(0)}%` : ''})`)
