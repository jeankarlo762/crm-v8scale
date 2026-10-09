// Regra ÚNICA de "pode entrar/ser enviado em campanha só sem site". Pura: recebe os campos do lead e o instante.
// A decisão antiga (websiteStatus) pode continuar gravada como HISTÓRICO, mas só vale como autorização comercial AGORA se:
//  - a investigação ATUAL terminou com conclusão FINAL (websiteOutcome) e o andamento está concluído (DONE);
//  - a evidência que sustenta a conclusão negativa ainda é vigente (websiteValidUntil no futuro);
//  - a cobertura mínima foi realmente concluída: etapas obrigatórias feitas, nenhuma interrompida, nada vencido;
//  - não há candidato pendente (plausível/inconclusivo/não avaliável/outra unidade) contra a conclusão negativa;
//  - a versão do classificador é aceita.
// Cota esgotada, evidência vencida ou candidato novo NUNCA são lidos como "continua sem site".
import { CLASSIFIER_VERSION } from './website-types'

export const NO_WEBSITE_STATUSES = new Set(['PROBABLY_NO_WEBSITE', 'SOCIAL_ONLY'])
export const NO_WEBSITE_MIN_CONFIDENCE = 0.6
export const ACCEPTED_CLASSIFIER_VERSIONS: string[] = [CLASSIFIER_VERSION]

export interface EligibilityLead {
  websiteStatus?: string | null
  websiteConfidence?: number | null
  websiteOutcome?: string | null
  websiteValidUntil?: Date | string | null
  classifierVersion?: string | null
  websiteCoverage?: unknown
  investigationState?: string | null
}

export type IneligibleReason =
  | 'STATUS_NOT_NEGATIVE' | 'CONFIDENCE_TOO_LOW' | 'DECISION_NOT_FINAL' | 'INVESTIGATION_NOT_DONE' | 'EVIDENCE_EXPIRED'
  | 'CLASSIFIER_VERSION_NOT_ACCEPTED' | 'COVERAGE_MISSING' | 'COVERAGE_INCOMPLETE' | 'STEP_INTERRUPTED' | 'NEGATIVE_EVIDENCE_STALE' | 'CANDIDATE_PENDING'

interface CoverageShape { required?: string[]; done?: string[]; failed?: string[]; staleNegative?: boolean; candidates?: { linkage?: string }[] }

export function noWebsiteEligibility(l: EligibilityLead, now = new Date()): { eligible: boolean; reasons: IneligibleReason[] } {
  const reasons: IneligibleReason[] = []
  if (!l.websiteStatus || !NO_WEBSITE_STATUSES.has(l.websiteStatus)) reasons.push('STATUS_NOT_NEGATIVE')
  if ((l.websiteConfidence ?? 0) < NO_WEBSITE_MIN_CONFIDENCE) reasons.push('CONFIDENCE_TOO_LOW')
  if (l.websiteOutcome !== 'FINAL') reasons.push('DECISION_NOT_FINAL') // INCOMPLETE, NEEDS_REVIEW, LEGACY ou nunca investigado
  if (l.investigationState !== 'DONE') reasons.push('INVESTIGATION_NOT_DONE')
  const until = l.websiteValidUntil ? new Date(l.websiteValidUntil).getTime() : NaN
  if (!Number.isFinite(until) || until <= now.getTime()) reasons.push('EVIDENCE_EXPIRED')
  if (!l.classifierVersion || !ACCEPTED_CLASSIFIER_VERSIONS.includes(l.classifierVersion)) reasons.push('CLASSIFIER_VERSION_NOT_ACCEPTED')
  const cov = (l.websiteCoverage && typeof l.websiteCoverage === 'object' ? l.websiteCoverage : null) as CoverageShape | null
  if (!cov || !Array.isArray(cov.required) || !Array.isArray(cov.done)) reasons.push('COVERAGE_MISSING')
  else {
    if (!cov.required.every((r) => cov.done?.includes(r))) reasons.push('COVERAGE_INCOMPLETE')
    if ((cov.failed ?? []).length > 0) reasons.push('STEP_INTERRUPTED')
    if (cov.staleNegative) reasons.push('NEGATIVE_EVIDENCE_STALE')
    if ((cov.candidates ?? []).some((c) => c.linkage !== 'CONTRADICTED')) reasons.push('CANDIDATE_PENDING')
  }
  return { eligible: reasons.length === 0, reasons }
}

export const eligibleForNoWebsite = (l: EligibilityLead, now = new Date()): boolean => noWebsiteEligibility(l, now).eligible
