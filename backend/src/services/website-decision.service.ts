// Decisão final "este lead tem site?" a partir do CONJUNTO de evidências já avaliadas. Pura e idempotente:
// mesmas entradas → mesma decisão (recalcular com evidências armazenadas NÃO exige reconsultar nada).
//
// Regras de ouro:
//  - achar URL ≠ achar o site do lead: só vínculo CONFIRMED (website-identity) vale como HAS_WEBSITE;
//  - nenhuma fonte decide sozinha uma conclusão NEGATIVA, e fonte que não respondeu (cota, erro, bloqueio, auth) NÃO é
//    "consultada sem resultado": a investigação fica INCOMPLETA, nunca vira "sem site";
//  - dois domínios não são conflito por si só (redirect antigo→novo, institucional+reservas, filiais);
//  - os números de confiança são HEURÍSTICOS (não calibrados): servem para ordenar, não são probabilidades.
import type { Linkage } from './website-identity.service'
import type { UrlKind } from './url-classify.service'
import { CLASSIFIER_VERSION, type Evidence, type SourceState, type WebsiteStatus } from './website-types'

export type { WebsiteStatus }
export type DecisionSource = 'GOOGLE' | 'TAVILY' | 'INSTAGRAM' | 'LINK_BIO' | 'MANUAL' | 'HISTORY'

export const DECISION_CONFIG = {
  negativeBase: 0.6,
  negativePhoneBonus: 0.1, // consulta por telefone feita e sem site
  negativeBioBonus: 0.1, // bio do Instagram confirmado lida e sem site
  negativeMultiQueryBonus: 0.05,
  negativeCap: 0.85, // ausência de evidência nunca vira certeza
  unknown: 0.2,
  conflict: 0.3,
  maxEvidence: 40,
}

export interface DecisionCandidate {
  url: string
  finalUrl: string | null // destino depois dos redirects
  siteKey: string // identidade do site (domínio registrável, ou host/caminho em plataforma compartilhada)
  domain: string // domínio registrável
  source: DecisionSource
  kind: UrlKind
  linkage: Linkage
  confidence: number
  health: string | null
  evidence: Evidence[]
  relatedKeys?: string[] // outros siteKeys comprovadamente do mesmo negócio (redirect antigo→novo, link entre os sites)
  collectedAt?: string
  fromCache?: boolean
}

export interface QueryRecord { key: string; state: SourceState; results: number; discarded: number; unevaluable: number; at: string; fromCache: boolean }

export type RequiredStep = 'GOOGLE' | 'TAVILY_NAME' | 'TAVILY_PHONE' | 'TAVILY_HANDLE' | 'META_BIO'
export interface Coverage {
  sources: { GOOGLE: SourceState; TAVILY: SourceState; INSTAGRAM: SourceState }
  required: RequiredStep[] // etapas que a conclusão NEGATIVA exige para este lead
  done: RequiredStep[] // etapas com resultado válido (consulta OK) e vigente
  failed: string[] // etapas tentadas/bloqueadas por erro, cota, rate limit, auth, config
  queries: QueryRecord[]
  staleNegative: boolean // evidência negativa vencida: precisa refazer antes de concluir
  exhausted: boolean // nada mais a tentar agora (sem etapa executável nem aguardando orçamento)
  calibrated: false
  validUntil?: string | null // menor validade (ISO) entre as evidências que sustentam a conclusão negativa
  notes?: string[] // cobertura alternativa usada, configuração insuficiente etc. (vão para os motivos da decisão)
}

export interface DecisionInput {
  candidates: DecisionCandidate[]
  social: { confirmed: boolean; via: string | null } // rede social CONFIRMADA (não só "possível @")
  coverage: Coverage
}

export interface Confirmation { valid: boolean; url: string | null; source: DecisionSource | null; at: string | null; evidence: Evidence[] }
export type DecisionOutcome = 'FINAL' | 'INCOMPLETE' | 'NEEDS_REVIEW'

export interface WebsiteDecision {
  status: WebsiteStatus
  confidence: number
  confirmedWebsite: string | null // só com vínculo CONFIRMED agora
  reasons: string[]
  primaryReason: string
  evidence: Evidence[]
  outcome: DecisionOutcome
  pending: string[]
  confirmation: Confirmation
  classifierVersion: string
  validUntil: string | null // só em conclusão negativa FINAL: até quando ela vale sem reinvestigar
}

const r2 = (n: number) => Math.round(n * 100) / 100
const rank = (c: DecisionCandidate) => (c.source === 'MANUAL' ? 2 : 0) + (c.health === 'ok' ? 0.5 : 0) + c.confidence

// Mesmo site? mesma chave, relação comprovada (redirect/link), ou mesmo domínio registrável — exceto plataforma por
// caminho com negócios diferentes (/site/a ≠ /site/b).
export function sameSite(a: DecisionCandidate, b: DecisionCandidate): boolean {
  if (a.siteKey === b.siteKey) return true
  if (a.relatedKeys?.includes(b.siteKey) || b.relatedKeys?.includes(a.siteKey)) return true
  const pathKeyed = (c: DecisionCandidate) => c.siteKey !== c.domain
  if (a.domain === b.domain) return !(pathKeyed(a) && pathKeyed(b))
  return false
}

function groupBySite(cs: DecisionCandidate[]): DecisionCandidate[][] {
  const groups: DecisionCandidate[][] = []
  for (const c of cs) {
    const g = groups.find((x) => x.some((y) => sameSite(x[0], c) || sameSite(y, c)))
    if (g) g.push(c); else groups.push([c])
  }
  return groups
}

export function decideWebsite(input: DecisionInput): WebsiteDecision {
  const C = DECISION_CONFIG
  const { coverage } = input
  const reasons: string[] = []
  const evidence: Evidence[] = []
  for (const [src, st] of Object.entries(coverage.sources)) evidence.push({ source: src, type: 'SOURCE_STATE', value: st, confidence: 0 })
  for (const q of coverage.queries) evidence.push({ source: 'TAVILY', type: 'QUERY', value: `${q.key} → ${q.state} (${q.results} res., ${q.discarded} desc., ${q.unevaluable} n/aval.)`, confidence: 0, at: q.at, fromCache: q.fromCache })
  for (const c of input.candidates) {
    evidence.push({ source: c.source, type: 'CANDIDATE', value: `${c.finalUrl ?? c.url} → ${c.linkage}`, confidence: c.confidence, at: c.collectedAt, fromCache: c.fromCache })
    evidence.push(...c.evidence)
  }
  const pending = [...new Set([...coverage.required.filter((r) => !coverage.done.includes(r)), ...coverage.failed])]
  for (const f of coverage.failed) reasons.push(`STEP_${f}`)
  for (const n of coverage.notes ?? []) reasons.push(n)
  for (const [src, st] of Object.entries(coverage.sources)) if (['NOT_CHECKED_QUOTA', 'RATE_LIMITED', 'API_ERROR', 'AUTH_PAUSED', 'NOT_CONFIGURED'].includes(st)) reasons.push(`${src}_${st}`)

  const noConfirmation: Confirmation = { valid: false, url: null, source: null, at: null, evidence: [] }
  const finish = (status: WebsiteStatus, confidence: number, outcome: DecisionOutcome, primary: string, confirmedWebsite: string | null = null, confirmation = noConfirmation): WebsiteDecision => {
    const rs = [primary, ...reasons.filter((r) => r !== primary)]
    return { status, confidence: r2(confidence), confirmedWebsite, reasons: rs, primaryReason: primary, evidence: evidence.slice(0, C.maxEvidence), outcome, pending, confirmation, classifierVersion: CLASSIFIER_VERSION, validUntil: outcome === 'FINAL' && (status === 'PROBABLY_NO_WEBSITE' || status === 'SOCIAL_ONLY') ? coverage.validUntil ?? null : null }
  }
  const unresolved = (status: WebsiteStatus, conf: number, primary: string) => finish(status, conf, coverage.exhausted ? 'NEEDS_REVIEW' : 'INCOMPLETE', primary)

  for (const c of input.candidates) if (c.linkage === 'CONTRADICTED') reasons.push(`${c.source}_URL_CONTRADICTED:${c.siteKey}`)
  const live = input.candidates.filter((c) => c.linkage !== 'CONTRADICTED')

  // 1) Vínculo confirmado → tem site (mesmo fora do ar: site fora do ar não é ausência de site).
  const confirmed = live.filter((c) => c.linkage === 'CONFIRMED').sort((a, b) => rank(b) - rank(a))
  if (confirmed.length > 0) {
    const top = confirmed[0]
    if (groupBySite(confirmed).length > 1) reasons.push('MULTIPLE_CONFIRMED_SITES') // não é conflito: negócio pode ter mais de um site
    if (top.health === 'fora_do_ar' || top.health === 'dominio_parado') reasons.push('SITE_DOWN')
    if (top.fromCache) reasons.push('CONFIRMED_FROM_STORED_EVIDENCE')
    const url = top.finalUrl ?? top.url
    return finish('HAS_WEBSITE', top.confidence, 'FINAL', top.source === 'MANUAL' ? 'MANUAL_CONFIRMED' : 'IDENTITY_CONFIRMED', url,
      { valid: true, url, source: top.source, at: top.collectedAt ?? null, evidence: top.evidence.filter((e) => e.confidence > 0).slice(0, 8) })
  }

  // 2) Candidatos que ainda não provam nada: investigação em aberto, nunca "sem site".
  const brand = live.filter((c) => c.linkage === 'BRAND_OTHER_UNIT')
  const plausible = live.filter((c) => c.linkage === 'PLAUSIBLE')
  const inconclusive = live.filter((c) => c.linkage === 'INCONCLUSIVE')
  const unevaluable = live.filter((c) => c.linkage === 'NOT_EVALUABLE')
  if (groupBySite(plausible).length >= 2) return unresolved('CONFLICT', C.conflict, 'PLAUSIBLE_CANDIDATES_INCOMPATIBLE')
  if (brand.length > 0) { reasons.push('BRAND_OTHER_UNIT_TO_INVESTIGATE'); return unresolved('UNKNOWN', C.unknown, 'BRAND_OTHER_UNIT') }
  if (plausible.length > 0) return unresolved('UNKNOWN', C.unknown, 'CANDIDATE_UNCONFIRMED')
  if (unevaluable.length > 0) return unresolved('UNKNOWN', C.unknown, unevaluable.some((c) => c.evidence.some((e) => e.type === 'PAGE_FACTS_EXPIRED')) ? 'CONFIRMATION_EXPIRED' : unevaluable.some((c) => c.source === 'HISTORY') ? 'PREVIOUS_CONFIRMATION_UNVERIFIED' : 'CANDIDATE_NOT_EVALUABLE')
  if (inconclusive.length > 0) return unresolved('UNKNOWN', C.unknown, 'CANDIDATE_INCONCLUSIVE')

  // 3) Sem nenhum candidato vivo: conclusão negativa só com investigação mínima COMPLETA e vigente.
  const complete = coverage.required.every((r) => coverage.done.includes(r)) && coverage.failed.length === 0 && !coverage.staleNegative
  if (!complete) {
    if (coverage.staleNegative) reasons.push('NEGATIVE_EVIDENCE_STALE')
    return unresolved('UNKNOWN', C.unknown, coverage.failed.length ? 'INVESTIGATION_INTERRUPTED' : 'INSUFFICIENT_EVIDENCE')
  }
  let conf = C.negativeBase
  if (coverage.done.includes('TAVILY_PHONE')) conf += C.negativePhoneBonus
  if (coverage.done.includes('META_BIO')) { conf += C.negativeBioBonus; reasons.push('INSTAGRAM_BIO_WITHOUT_SITE') }
  if (coverage.queries.filter((q) => q.state === 'CHECKED_NO_RESULT' || q.state === 'CHECKED_RESULTS_DISCARDED').length >= 2) conf += C.negativeMultiQueryBonus
  conf = Math.min(C.negativeCap, conf)
  if (input.social.confirmed) return finish('SOCIAL_ONLY', conf, 'FINAL', 'SOCIAL_CONFIRMED_NO_SITE')
  return finish('PROBABLY_NO_WEBSITE', conf, 'FINAL', 'NO_SITE_AFTER_FULL_INVESTIGATION')
}
