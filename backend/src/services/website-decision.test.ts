import { describe, it, expect } from 'vitest'
import { decideWebsite, type Coverage, type DecisionCandidate, type DecisionInput, DECISION_CONFIG } from './website-decision.service'
import type { Linkage } from './website-identity.service'

const cov = (over: Partial<Coverage> = {}): Coverage => ({
  sources: { GOOGLE: 'CHECKED_NO_RESULT', TAVILY: 'CHECKED_NO_RESULT', INSTAGRAM: 'NOT_CHECKED' },
  required: ['GOOGLE', 'TAVILY_NAME', 'TAVILY_PHONE'], done: ['GOOGLE', 'TAVILY_NAME', 'TAVILY_PHONE'], failed: [], queries: [],
  staleNegative: false, exhausted: true, calibrated: false, ...over,
})
const cand = (key: string, linkage: Linkage, over: Partial<DecisionCandidate> = {}): DecisionCandidate => ({
  url: `https://${key}`, finalUrl: `https://${key}`, siteKey: key, domain: key, source: 'TAVILY', kind: 'OWN_WEBSITE', linkage,
  confidence: linkage === 'CONFIRMED' ? 0.85 : linkage === 'PLAUSIBLE' ? 0.4 : 0.2, health: 'ok', evidence: [], ...over,
})
const input = (candidates: DecisionCandidate[] = [], c: Coverage = cov(), social = false): DecisionInput => ({ candidates, coverage: c, social: { confirmed: social, via: social ? 'SEARCH' : null } })

describe('decideWebsite: vínculo confirmado', () => {
  it('site com vínculo CONFIRMED → HAS_WEBSITE, com confirmação válida registrada (origem, data, evidências)', () => {
    const c = cand('arenatribo.com.br', 'CONFIRMED', { collectedAt: '2026-10-01T10:00:00Z', evidence: [{ source: 'WEBSITE', type: 'PHONE_MATCH_BUSINESS', value: 'x', confidence: 0.5 }] })
    const d = decideWebsite(input([c], cov({ done: [] })))
    expect(d.status).toBe('HAS_WEBSITE')
    expect(d.outcome).toBe('FINAL')
    expect(d.confirmedWebsite).toBe('https://arenatribo.com.br')
    expect(d.confirmation).toMatchObject({ valid: true, source: 'TAVILY', at: '2026-10-01T10:00:00Z' })
    expect(d.confirmation.evidence[0].type).toBe('PHONE_MATCH_BUSINESS')
  })
  it('site confirmado fora do ar continua HAS_WEBSITE (site fora do ar ≠ ausência de site), com motivo SITE_DOWN', () => {
    const d = decideWebsite(input([cand('arenatribo.com.br', 'CONFIRMED', { health: 'fora_do_ar' })], cov({ done: [] })))
    expect(d.status).toBe('HAS_WEBSITE')
    expect(d.reasons).toContain('SITE_DOWN')
  })
  it('vários sites CONFIRMADOS (institucional + reservas, redirect, filial) NÃO são conflito', () => {
    const a = cand('arenatribo.com.br', 'CONFIRMED')
    const b = cand('reservasarena.com', 'CONFIRMED')
    const d = decideWebsite(input([a, b], cov({ done: [] })))
    expect(d.status).toBe('HAS_WEBSITE')
    expect(d.reasons).toContain('MULTIPLE_CONFIRMED_SITES')
  })
  it('site manual confirmado vence e tem motivo próprio', () => {
    const d = decideWebsite(input([cand('meusite.com.br', 'CONFIRMED', { source: 'MANUAL', confidence: 1 }), cand('outro.com', 'CONFIRMED')], cov({ done: [] })))
    expect(d.confirmedWebsite).toBe('https://meusite.com.br')
    expect(d.primaryReason).toBe('MANUAL_CONFIRMED')
  })
  it('é idempotente: mesmas entradas, mesma decisão', () => {
    const i = input([cand('a.com', 'PLAUSIBLE')], cov({ exhausted: false }))
    expect(decideWebsite(i)).toEqual(decideWebsite(i))
  })
})

describe('decideWebsite: candidatos que não provam nada nunca viram "sem site"', () => {
  it('candidato só PLAUSÍVEL → UNKNOWN (nunca HAS_WEBSITE) e bloqueia a conclusão negativa', () => {
    const d = decideWebsite(input([cand('a.com', 'PLAUSIBLE')]))
    expect(d.status).toBe('UNKNOWN')
    expect(d.primaryReason).toBe('CANDIDATE_UNCONFIRMED')
    expect(d.outcome).toBe('NEEDS_REVIEW') // investigação esgotada: revisão manual
  })
  it('enquanto há etapas por fazer a decisão fica INCOMPLETE, não em revisão manual', () => {
    expect(decideWebsite(input([cand('a.com', 'PLAUSIBLE')], cov({ exhausted: false }))).outcome).toBe('INCOMPLETE')
  })
  it('candidato NÃO AVALIÁVEL (403, SPA, não baixado) impede o negativo', () => {
    const d = decideWebsite(input([cand('a.com', 'NOT_EVALUABLE')]))
    expect(d.status).toBe('UNKNOWN')
    expect(d.primaryReason).toBe('CANDIDATE_NOT_EVALUABLE')
  })
  it('candidato INCONCLUSIVO (página sem nome/telefone) impede o negativo', () => {
    expect(decideWebsite(input([cand('a.com', 'INCONCLUSIVE')])).primaryReason).toBe('CANDIDATE_INCONCLUSIVE')
  })
  it('outra unidade da mesma marca → UNKNOWN com motivo "a investigar"', () => {
    const d = decideWebsite(input([cand('a.com', 'BRAND_OTHER_UNIT')]))
    expect(d.primaryReason).toBe('BRAND_OTHER_UNIT')
    expect(d.reasons).toContain('BRAND_OTHER_UNIT_TO_INVESTIGATE')
  })
  it('confirmação histórica que não pôde ser revalidada agora → UNKNOWN (sem piso de confiança, sem HAS_WEBSITE)', () => {
    const d = decideWebsite(input([cand('antigo.com', 'NOT_EVALUABLE', { source: 'HISTORY' })]))
    expect(d.status).toBe('UNKNOWN')
    expect(d.primaryReason).toBe('PREVIOUS_CONFIRMATION_UNVERIFIED')
    expect(d.confirmation.valid).toBe(false)
  })
  it('candidato CONTRADITO é descartado (com motivo) e não impede o negativo', () => {
    const d = decideWebsite(input([cand('hotelbeta.com', 'CONTRADICTED', { source: 'GOOGLE' })]))
    expect(d.status).toBe('PROBABLY_NO_WEBSITE')
    expect(d.reasons).toContain('GOOGLE_URL_CONTRADICTED:hotelbeta.com')
  })
})

describe('decideWebsite: CONFLICT só para candidatos incompatíveis', () => {
  it('dois candidatos plausíveis de sites sem relação → CONFLICT', () => {
    expect(decideWebsite(input([cand('a.com', 'PLAUSIBLE'), cand('b.com', 'PLAUSIBLE')])).status).toBe('CONFLICT')
  })
  it('dois plausíveis RELACIONADOS (redirect/link entre eles) → não é conflito', () => {
    const a = cand('a.com', 'PLAUSIBLE', { relatedKeys: ['b.com'] })
    expect(decideWebsite(input([a, cand('b.com', 'PLAUSIBLE')])).status).toBe('UNKNOWN')
  })
  it('mesmo domínio registrável (reservas.a.com e a.com) é o mesmo site', () => {
    const a = cand('a.com', 'PLAUSIBLE'); const b = cand('a.com', 'PLAUSIBLE', { url: 'https://reservas.a.com' })
    expect(decideWebsite(input([a, b])).status).toBe('UNKNOWN')
  })
  it('plataforma por caminho: /site/a e /site/b no mesmo domínio são sites diferentes', () => {
    const a = cand('plat.com/site/a', 'PLAUSIBLE', { domain: 'plat.com' }); const b = cand('plat.com/site/b', 'PLAUSIBLE', { domain: 'plat.com' })
    expect(decideWebsite(input([a, b])).status).toBe('CONFLICT')
  })
})

describe('decideWebsite: conclusão negativa exige investigação completa e vigente', () => {
  it('tudo feito, nenhum candidato → PROBABLY_NO_WEBSITE, confiança heurística limitada pelo teto', () => {
    const d = decideWebsite(input())
    expect(d.status).toBe('PROBABLY_NO_WEBSITE')
    expect(d.outcome).toBe('FINAL')
    expect(d.confidence).toBeLessThanOrEqual(DECISION_CONFIG.negativeCap)
  })
  it('rede social confirmada + ausência de site → SOCIAL_ONLY; rede só sugerida não muda nada', () => {
    expect(decideWebsite(input([], cov(), true)).status).toBe('SOCIAL_ONLY')
    expect(decideWebsite(input([], cov(), false)).status).toBe('PROBABLY_NO_WEBSITE')
  })
  it('falta uma etapa obrigatória (telefone) → UNKNOWN, nunca sem site', () => {
    const d = decideWebsite(input([], cov({ done: ['GOOGLE', 'TAVILY_NAME'], exhausted: false })))
    expect(d.status).toBe('UNKNOWN')
    expect(d.outcome).toBe('INCOMPLETE')
    expect(d.pending).toContain('TAVILY_PHONE')
  })
  it.each(['TAVILY_NAME', 'META_BIO', 'LINK_RESOLVE'])('etapa %s interrompida por cota/erro/bloqueio impede o negativo', (step) => {
    const d = decideWebsite(input([], cov({ failed: [step], sources: { GOOGLE: 'CHECKED_NO_RESULT', TAVILY: 'NOT_CHECKED_QUOTA', INSTAGRAM: 'RATE_LIMITED' }, exhausted: false })))
    expect(d.status).toBe('UNKNOWN')
    expect(d.primaryReason).toBe('INVESTIGATION_INTERRUPTED')
    expect(d.reasons).toEqual(expect.arrayContaining([`STEP_${step}`, 'TAVILY_NOT_CHECKED_QUOTA', 'INSTAGRAM_RATE_LIMITED']))
  })
  it('evidência negativa vencida não sustenta o negativo', () => {
    const d = decideWebsite(input([], cov({ staleNegative: true, exhausted: false })))
    expect(d.status).toBe('UNKNOWN')
    expect(d.reasons).toContain('NEGATIVE_EVIDENCE_STALE')
  })
  it('bio do Instagram lida e sem site, e telefone consultado, aumentam a confiança (heurística) sem passar do teto', () => {
    const base = decideWebsite(input([], cov({ required: ['GOOGLE', 'TAVILY_NAME'], done: ['GOOGLE', 'TAVILY_NAME'] }))).confidence
    const full = decideWebsite(input([], cov({ required: ['GOOGLE', 'TAVILY_NAME', 'TAVILY_PHONE', 'META_BIO'], done: ['GOOGLE', 'TAVILY_NAME', 'TAVILY_PHONE', 'META_BIO'] }), true))
    expect(full.confidence).toBeGreaterThan(base)
    expect(full.confidence).toBeLessThanOrEqual(DECISION_CONFIG.negativeCap)
    expect(full.reasons).toContain('INSTAGRAM_BIO_WITHOUT_SITE')
  })
  it('lead importado (sem placeId): o Google não é etapa obrigatória, mas Tavily sim', () => {
    expect(decideWebsite(input([], cov({ required: ['TAVILY_NAME'], done: ['TAVILY_NAME'], sources: { GOOGLE: 'NOT_CHECKED', TAVILY: 'CHECKED_NO_RESULT', INSTAGRAM: 'NOT_CHECKED' } }))).status).toBe('PROBABLY_NO_WEBSITE')
    expect(decideWebsite(input([], cov({ required: ['TAVILY_NAME'], done: [] , exhausted: false}))).status).toBe('UNKNOWN')
  })
  it('registra cobertura nas evidências: estado de cada fonte e cada consulta', () => {
    const d = decideWebsite(input([], cov({ queries: [{ key: 'Arena Tribo Tubarão SC', state: 'CHECKED_RESULTS_DISCARDED', results: 6, discarded: 6, unevaluable: 0, at: '2026-10-01T10:00:00Z', fromCache: true }] })))
    expect(d.evidence.find((e) => e.type === 'SOURCE_STATE' && e.source === 'TAVILY')?.value).toBe('CHECKED_NO_RESULT')
    const q = d.evidence.find((e) => e.type === 'QUERY')
    expect(q?.value).toContain('CHECKED_RESULTS_DISCARDED')
    expect(q?.fromCache).toBe(true)
  })
})
