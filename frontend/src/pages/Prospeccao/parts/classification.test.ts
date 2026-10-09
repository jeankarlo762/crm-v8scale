import { describe, it, expect } from 'vitest'
import tableSrc from './LeadsTable.tsx?raw'
import { listDecision, sourceEvidence, LIST_DECISION_LABEL, type ListDecisionKey } from './classification'
import { DECISION_LABEL, DECISION_OPTIONS, SITE_LABEL, SITE_OPTIONS } from './shared'
import type { InvestigationState, WebsiteStatus } from '../../../api/lead.api'

const base = { websiteStatus: null, investigationState: null, investigationLastError: null, enrichError: null, websiteCoverage: null } as Parameters<typeof listDecision>[0]
const full = { sources: { GOOGLE: 'CHECKED_NO_RESULT', TAVILY: 'CHECKED_NO_RESULT', INSTAGRAM: 'CHECKED_NO_RESULT' } }
const googleOnly = { sources: { GOOGLE: 'CHECKED_NO_RESULT', TAVILY: 'NOT_CHECKED', INSTAGRAM: 'NOT_CHECKED' } }

describe('listDecision', () => {
  it('mapeia a decisão final', () => {
    expect(listDecision({ ...base, websiteStatus: 'HAS_WEBSITE' })).toBe('HAS_WEBSITE')
    expect(listDecision({ ...base, websiteStatus: 'SOCIAL_ONLY' })).toBe('SOCIAL_ONLY')
    expect(listDecision({ ...base, websiteStatus: 'CONFLICT' })).toBe('CONFLICT')
    expect(listDecision({ ...base, websiteStatus: 'PROBABLY_NO_WEBSITE', investigationState: 'DONE', websiteCoverage: full })).toBe('PROBABLY_NO_WEBSITE')
  })
  it('UNKNOWN, sem decisão, pendente, cota e erro viram "Em análise"', () => {
    expect(listDecision({ ...base, websiteStatus: 'UNKNOWN' })).toBe('IN_ANALYSIS')
    expect(listDecision(base)).toBe('IN_ANALYSIS')
    for (const st of ['PENDING', 'PROCESSING', 'WAITING_QUOTA', 'WAITING_RETRY'] as InvestigationState[])
      expect(listDecision({ ...base, websiteStatus: 'PROBABLY_NO_WEBSITE', investigationState: st, websiteCoverage: full })).toBe('IN_ANALYSIS')
    expect(listDecision({ ...base, websiteStatus: 'PROBABLY_NO_WEBSITE', investigationState: 'DONE', investigationLastError: 'x', websiteCoverage: full })).toBe('IN_ANALYSIS')
  })
  it('só o Google consultado sem URL não é "Provavelmente sem site"', () => {
    expect(listDecision({ ...base, websiteStatus: 'PROBABLY_NO_WEBSITE', investigationState: 'DONE', websiteCoverage: googleOnly })).toBe('IN_ANALYSIS')
  })
  it('nenhuma combinação exibe "Sem site no Google" como decisão principal', () => {
    const sts: (WebsiteStatus | null)[] = [null, 'HAS_WEBSITE', 'PROBABLY_NO_WEBSITE', 'SOCIAL_ONLY', 'UNKNOWN', 'CONFLICT']
    const ps: (InvestigationState | null)[] = [null, 'PENDING', 'PROCESSING', 'WAITING_QUOTA', 'WAITING_RETRY', 'DONE', 'MANUAL_REVIEW']
    const allowed = new Set<string>(Object.values(LIST_DECISION_LABEL))
    for (const websiteStatus of sts) for (const investigationState of ps) for (const websiteCoverage of [null, full, googleOnly]) {
      const k: ListDecisionKey = listDecision({ ...base, websiteStatus, investigationState, websiteCoverage })
      expect(allowed.has(LIST_DECISION_LABEL[k])).toBe(true)
      expect(LIST_DECISION_LABEL[k]).not.toMatch(/sem site no google/i)
    }
  })
})

describe('rótulos visíveis', () => {
  it('nenhum rótulo de decisão ou filtro usa "Sem site no Google"', () => {
    for (const d of DECISION_OPTIONS) expect(DECISION_LABEL[d]).not.toMatch(/sem site no google/i)
    for (const s of SITE_OPTIONS) expect(SITE_LABEL[s]).not.toMatch(/sem site no google/i)
  })
  it('a lista usa um único pill de classificação (sem SitePill/DecisionPill)', () => {
    const src = tableSrc
    expect(src).not.toMatch(/<SitePill|<DecisionPill|<ProgressBadge/)
    expect(src.match(/<ClassificationPill/g)?.length).toBe(2) // tabela e cartão mobile
  })
})

describe('sourceEvidence (gaveta)', () => {
  const lead = { website: null, siteUrl: null, statusSite: 'sem_site', verificadoEm: null, instagramHandle: null, instagramVerificar: false, websiteCoverage: { sources: full.sources }, websiteEvidence: [{ source: 'TAVILY', type: 'QUERY', value: null, confidence: 0, at: '2026-10-01T10:00:00Z', fromCache: true }] } as unknown as Parameters<typeof sourceEvidence>[0]
  it('textos claros por fonte, com data e cache', () => {
    const [g, t, m] = sourceEvidence(lead)
    expect(g.text).toBe('Nenhuma URL de site informada')
    expect(t.text).toBe('Nenhum site próprio encontrado')
    expect(t.fromCache).toBe(true)
    expect(t.at).toBe('2026-10-01T10:00:00Z')
    expect(m.text).toBe('Nenhum perfil encontrado')
    expect(sourceEvidence({ ...lead, websiteCoverage: null })[2].text).toBe('Não consultado')
  })
  it('Meta: perfil confirmado vs possível', () => {
    expect(sourceEvidence({ ...lead, instagramHandle: 'x' })[2].text).toBe('Perfil confirmado')
    expect(sourceEvidence({ ...lead, instagramHandle: 'x', instagramVerificar: true })[2].text).toBe('Possível perfil')
  })
})
