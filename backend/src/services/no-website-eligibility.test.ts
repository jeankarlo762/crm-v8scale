import { describe, it, expect } from 'vitest'
import { noWebsiteEligibility, eligibleForNoWebsite, type EligibilityLead } from './no-website-eligibility.service'
import { CLASSIFIER_VERSION } from './website-types'

const NOW = new Date('2026-10-05T12:00:00Z')
const ok = (over: Partial<EligibilityLead> = {}): EligibilityLead => ({
  websiteStatus: 'PROBABLY_NO_WEBSITE', websiteConfidence: 0.8, websiteOutcome: 'FINAL', investigationState: 'DONE', classifierVersion: CLASSIFIER_VERSION,
  websiteValidUntil: new Date(NOW.getTime() + 3600_000),
  websiteCoverage: { required: ['GOOGLE', 'TAVILY_NAME', 'TAVILY_PHONE'], done: ['GOOGLE', 'TAVILY_NAME', 'TAVILY_PHONE'], failed: [], staleNegative: false, candidates: [{ linkage: 'CONTRADICTED' }] },
  ...over,
})
const why = (l: EligibilityLead) => noWebsiteEligibility(l, NOW).reasons

describe('elegibilidade para campanha "só sem site" (regra única)', () => {
  it('conclusão FINAL com evidência vigente, cobertura completa e sem candidato pendente → elegível (candidato CONTRADITO não pesa)', () => {
    expect(noWebsiteEligibility(ok(), NOW)).toEqual({ eligible: true, reasons: [] })
    expect(eligibleForNoWebsite(ok({ websiteStatus: 'SOCIAL_ONLY', websiteConfidence: 0.6 }), NOW)).toBe(true)
  })

  it('negativo antigo + evidência VENCIDA + cota esgotada (investigação incompleta): NÃO elegível — o histórico não autoriza', () => {
    const l = ok({ websiteValidUntil: new Date(NOW.getTime() - 1000), websiteOutcome: 'INCOMPLETE', investigationState: 'WAITING_QUOTA', websiteCoverage: { required: ['GOOGLE', 'TAVILY_NAME'], done: ['GOOGLE'], failed: ['TAVILY_NAME'], staleNegative: true, candidates: [] } })
    expect(l.websiteStatus).toBe('PROBABLY_NO_WEBSITE') // a decisão antiga continua visível como histórico
    expect(noWebsiteEligibility(l, NOW).eligible).toBe(false)
    expect(why(l)).toEqual(expect.arrayContaining(['DECISION_NOT_FINAL', 'INVESTIGATION_NOT_DONE', 'EVIDENCE_EXPIRED', 'COVERAGE_INCOMPLETE', 'STEP_INTERRUPTED', 'NEGATIVE_EVIDENCE_STALE']))
  })

  it('candidato novo pendente contra negativo antigo: NÃO elegível (plausível, inconclusivo, não avaliável ou outra unidade)', () => {
    for (const linkage of ['PLAUSIBLE', 'INCONCLUSIVE', 'NOT_EVALUABLE', 'BRAND_OTHER_UNIT', 'CONFIRMED']) {
      const l = ok({ websiteCoverage: { required: ['GOOGLE'], done: ['GOOGLE'], failed: [], staleNegative: false, candidates: [{ linkage: 'CONTRADICTED' }, { linkage }] } })
      expect(why(l)).toContain('CANDIDATE_PENDING')
    }
  })

  it('validade exatamente no limite já NÃO vale; sem websiteValidUntil (legado) não vale', () => {
    expect(why(ok({ websiteValidUntil: NOW }))).toContain('EVIDENCE_EXPIRED')
    expect(why(ok({ websiteValidUntil: null }))).toContain('EVIDENCE_EXPIRED')
  })

  it('decisão LEGACY / sem investigação nunca é elegível, mesmo com status e confiança altos', () => {
    expect(why(ok({ websiteOutcome: 'LEGACY' }))).toContain('DECISION_NOT_FINAL')
    expect(why({ websiteStatus: 'PROBABLY_NO_WEBSITE', websiteConfidence: 0.95 })).toEqual(expect.arrayContaining(['DECISION_NOT_FINAL', 'COVERAGE_MISSING', 'EVIDENCE_EXPIRED', 'CLASSIFIER_VERSION_NOT_ACCEPTED']))
  })

  it('versão do classificador não aceita; andamento em curso; cobertura sem as etapas obrigatórias', () => {
    expect(why(ok({ classifierVersion: '2025-01-01.0' }))).toContain('CLASSIFIER_VERSION_NOT_ACCEPTED')
    for (const st of ['PENDING', 'PROCESSING', 'WAITING_QUOTA', 'WAITING_RETRY', 'MANUAL_REVIEW', null]) expect(why(ok({ investigationState: st }))).toContain('INVESTIGATION_NOT_DONE')
    expect(why(ok({ websiteCoverage: { required: ['GOOGLE', 'TAVILY_NAME'], done: ['GOOGLE'], failed: [], staleNegative: false, candidates: [] } }))).toContain('COVERAGE_INCOMPLETE')
  })

  it('status que não é ausência de site e confiança baixa nunca passam', () => {
    for (const s of ['UNKNOWN', 'CONFLICT', 'HAS_WEBSITE', null]) expect(why(ok({ websiteStatus: s }))).toContain('STATUS_NOT_NEGATIVE')
    expect(why(ok({ websiteConfidence: 0.59 }))).toContain('CONFIDENCE_TOO_LOW')
  })
})
