import { describe, it, expect } from 'vitest'
import { CLASSIFIER_VERSION } from './website-types'
import { computeLeadScore, classificationConfidence, investigationPriority, eligibleForNoWebsiteCampaign, SCORE_WEIGHTS, type ScoreInput } from './lead-score.service'

const base: ScoreInput = {
  avaliacao: 4.5, numAvaliacoes: 100, statusSite: 'sem_site', siteStatus: null, whatsapp: '48999999999',
  instagram: null, instagramHandle: null, foundWebsite: null, foundSiteStatus: null,
}
const with_ = (websiteStatus: string | null, extra: Partial<ScoreInput> = {}): ScoreInput => ({ ...base, websiteStatus, websiteConfidence: 0.8, ...extra })

const ELIGIBLE_BASE = {
  websiteOutcome: 'FINAL', investigationState: 'DONE', classifierVersion: CLASSIFIER_VERSION, websiteValidUntil: new Date(Date.now() + 3600_000),
  websiteCoverage: { required: ['GOOGLE', 'TAVILY_NAME'], done: ['GOOGLE', 'TAVILY_NAME'], failed: [], staleNegative: false, candidates: [] },
}

describe('potencial comercial: só decisão de ausência de site rende o bônus', () => {
  it('status NULO não recebe bônus de "sem site" (mesmo com statusSite legado sem_site)', () => {
    const sem = computeLeadScore(with_('PROBABLY_NO_WEBSITE'))
    const nulo = computeLeadScore(with_(null))
    expect(sem - nulo).toBe(SCORE_WEIGHTS.bonusSemSiteProprio)
  })
  it('UNKNOWN e CONFLICT também não recebem o bônus (ausência de evidência ≠ sem site)', () => {
    expect(computeLeadScore(with_('UNKNOWN'))).toBe(computeLeadScore(with_(null)))
    expect(computeLeadScore(with_('CONFLICT'))).toBe(computeLeadScore(with_(null)))
  })
  it('SOCIAL_ONLY conta como sem site; Instagram confirmado dá bônus extra só aí', () => {
    expect(computeLeadScore(with_('SOCIAL_ONLY', { instagramHandle: 'x' }))).toBeGreaterThan(computeLeadScore(with_('SOCIAL_ONLY')))
    expect(computeLeadScore(with_('UNKNOWN', { instagramHandle: 'x' }))).toBe(computeLeadScore(with_('UNKNOWN')))
    expect(computeLeadScore(with_('SOCIAL_ONLY', { instagramHandle: 'x', instagramVerificar: true }))).toBe(computeLeadScore(with_('SOCIAL_ONLY')))
  })
  it('site confirmado e funcionando penaliza; fora do ar NÃO é ausência de site (neutro, sem bônus)', () => {
    const ok = computeLeadScore(with_('HAS_WEBSITE', { siteStatus: 'ok' }))
    const down = computeLeadScore(with_('HAS_WEBSITE', { siteStatus: 'fora_do_ar' }))
    expect(computeLeadScore(with_(null)) - ok).toBe(SCORE_WEIGHTS.penalidadeSiteOk)
    expect(down).toBe(computeLeadScore(with_(null)))
    expect(down).toBeLessThan(computeLeadScore(with_('PROBABLY_NO_WEBSITE')))
  })
  it('HAS_WEBSITE de baixa confiança não derruba o score', () => {
    expect(computeLeadScore(with_('HAS_WEBSITE', { websiteConfidence: 0.3 }))).toBe(computeLeadScore(with_(null)))
  })
  it('sem telefone vai para o fim', () => {
    expect(computeLeadScore(with_('PROBABLY_NO_WEBSITE', { whatsapp: null }))).toBeLessThan(computeLeadScore(with_('HAS_WEBSITE', { siteStatus: 'ok' })))
  })
})

describe('potencial comercial: contato e porte', () => {
  const b = with_(null, { numAvaliacoes: 10, phoneMobile: null })
  it('celular pontua mais que fixo', () => {
    expect(computeLeadScore({ ...b, phoneMobile: true }) - computeLeadScore(b)).toBe(SCORE_WEIGHTS.bonusCelular)
    expect(computeLeadScore(b) - computeLeadScore({ ...b, phoneMobile: false })).toBeCloseTo(SCORE_WEIGHTS.penalidadeFixo, 5)
  })
  it('faixa 50-400 avaliações ganha bônus; acima de 800 leva penalidade', () => {
    const at = (n: number) => computeLeadScore({ ...b, numAvaliacoes: n, avaliacao: 0 })
    expect(at(50) - at(49)).toBe(SCORE_WEIGHTS.bonusAvaliacoesIdeais)
    expect(at(800) - at(801)).toBe(SCORE_WEIGHTS.penalidadeAvaliacoesAltas)
  })
  it('mesmo celular em 2+ negócios é contato compartilhado: NÃO dá bônus de dono', () => {
    expect(computeLeadScore({ ...b, ownerGroupSize: 3 })).toBe(computeLeadScore({ ...b, ownerGroupSize: 1 }))
  })
})

describe('três eixos separados', () => {
  it('confiança da classificação = websiteConfidence (heurística), e 0 sem decisão', () => {
    expect(classificationConfidence({ websiteStatus: 'UNKNOWN', websiteConfidence: 0.2 })).toBe(0.2)
    expect(classificationConfidence({ websiteStatus: null, websiteConfidence: 0.9 })).toBe(0)
  })
  it('prioridade de investigação ordena por contato e avaliações, sem olhar a decisão', () => {
    const a = investigationPriority({ phoneMobile: true, whatsapp: '48999999999', numAvaliacoes: 200, avaliacao: 4.8, instagramHandle: 'x' })
    const b2 = investigationPriority({ phoneMobile: false, whatsapp: '4833334444', numAvaliacoes: 3, avaliacao: 3 })
    expect(a).toBeGreaterThan(b2)
  })
  it('só ausência de site decidida, com confiança mínima E comprovação vigente, entra em campanha "sem site"', () => {
    const ok = { websiteStatus: 'PROBABLY_NO_WEBSITE', websiteConfidence: 0.7, ...ELIGIBLE_BASE }
    expect(eligibleForNoWebsiteCampaign(ok)).toBe(true)
    expect(eligibleForNoWebsiteCampaign({ ...ok, websiteStatus: 'SOCIAL_ONLY', websiteConfidence: 0.6 })).toBe(true)
    expect(eligibleForNoWebsiteCampaign({ ...ok, websiteConfidence: 0.3 })).toBe(false)
    for (const s of ['UNKNOWN', 'CONFLICT', 'HAS_WEBSITE', null, undefined]) expect(eligibleForNoWebsiteCampaign({ ...ok, websiteStatus: s, websiteConfidence: 0.95 })).toBe(false)
    // status + confiança sozinhos NÃO bastam (decisão antiga é só histórico)
    expect(eligibleForNoWebsiteCampaign({ websiteStatus: 'PROBABLY_NO_WEBSITE', websiteConfidence: 0.95 })).toBe(false)
  })
})
