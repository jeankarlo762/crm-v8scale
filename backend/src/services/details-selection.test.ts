import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  prisma: { prospect: { findMany: vi.fn(), updateMany: vi.fn() }, leadEvidence: { findMany: vi.fn() } },
  kick: vi.fn(),
}))
vi.mock('../config/database', () => ({ prisma: mocks.prisma }))
vi.mock('./provider-state.service', () => ({ getProviderPause: async () => null, listProviderStates: async () => [], pauseProvider: async () => {}, resumeProvider: async () => {} }))
vi.mock('./site-classify-queue.service', () => ({ kick: mocks.kick }))

import { env } from '../config/env'
import { detailsPriority, selectLeadsForDetails, enqueueDetails } from './details-selection.service'
import { MemoryQuotaStore, reserve, setQuotaStore, _resetQuotaForTests } from './api-quota.service'

const T = ['Beach tennis', 'quadra de areia']
const lead = (id: string, over: Record<string, unknown> = {}) => ({ id, arenaName: `Arena ${id}`, address: `Rua ${id}, 10 - Centro, Tubarão - SC`, primaryType: 'sports_club', city: 'Tubarão', state: 'SC', createdAt: new Date(2026, 0, Number(id.replace(/\D/g, '')) || 1), ...over })

describe('priorização do Place Details Enterprise (só campos do Text Search Pro)', () => {
  beforeEach(() => {
    vi.clearAllMocks(); _resetQuotaForTests(); setQuotaStore(new MemoryQuotaStore())
    Object.assign(env, { GOOGLE_PLACE_DETAILS_ENTERPRISE_MAX_CALLS_PER_RUN: 50, GOOGLE_PLACE_DETAILS_ENTERPRISE_MONTHLY_BUDGET: 1000, API_QUOTA_SAFETY_PERCENT: 10, GOOGLE_PLACE_DETAILS_ENTERPRISE_EXTERNAL_RESERVED: 0, GOOGLE_PLACE_DETAILS_ENTERPRISE_PRIOR_USAGE: undefined, GOOGLE_PLACE_DETAILS_ENTERPRISE_PRIOR_USAGE_UNTIL: undefined, GOOGLE_PLACES_QUOTA_RESET: 'FIXED', GOOGLE_PLACES_QUOTA_SHARED: 'false', GOOGLE_DETAILS_ENRICH_MAX_PER_REQUEST: 25, GOOGLE_EVIDENCE_TTL_HOURS: 720, API_OPERATION_BUDGETS: undefined, API_QUOTA_ALLOW_ABOVE_DOCUMENTED_CAP: 'false' })
    mocks.prisma.leadEvidence.findMany.mockResolvedValue([])
  })

  it('prioridade: tipo do lugar combina com a aba > endereço com número > cidade/UF', () => {
    const base = { address: 'Rua A, 10', city: 'Tubarão', state: 'SC' }
    expect(detailsPriority({ ...base, primaryType: 'tennis_court' }, ['Beach tennis'])).toBeGreaterThan(detailsPriority({ ...base, primaryType: 'bakery' }, ['Beach tennis']))
    expect(detailsPriority({ ...base, primaryType: null }, T)).toBeGreaterThan(detailsPriority({ address: 'Centro', city: null, state: null, primaryType: null }, T))
  })

  it('seleciona só os melhores até o limite do clique, o resto fica AGUARDANDO (nenhum Details é gasto à toa)', async () => {
    mocks.prisma.prospect.findMany.mockResolvedValue([lead('1', { primaryType: 'bakery' }), lead('2', { primaryType: 'tennis_court' }), lead('3', { primaryType: 'tennis_court' }), lead('4', { address: null, primaryType: null })])
    const r = await selectLeadsForDetails({ nichoId: 'n', nichoTermos: ['Beach tennis'], limite: 2 })
    expect(r.selecionados).toHaveLength(2)
    expect(r.selecionados).toEqual(expect.arrayContaining(['2', '3'])) // os de tipo compatível
    expect(r.aguardando).toBe(2)
  })

  it('o limite é o MENOR entre pedido, teto por clique e SALDO do Details (margem incluída)', async () => {
    const many = Array.from({ length: 60 }, (_, i) => lead(String(i + 1), { arenaName: `Quadra ${i + 1}`, address: `Rua ${i + 1}, ${i + 1}` }))
    mocks.prisma.prospect.findMany.mockResolvedValue(many)
    expect((await selectLeadsForDetails({ nichoId: 'n', nichoTermos: T })).selecionados).toHaveLength(25) // teto por clique
    expect((await selectLeadsForDetails({ nichoId: 'n', nichoTermos: T, limite: 100 })).selecionados).toHaveLength(25) // pedido maior não passa do teto
    for (let i = 0; i < 893; i++) await reserve('GOOGLE_PLACE_DETAILS_ENTERPRISE', { operation: 'PLACE_DETAILS_ENTERPRISE' }) // saldo: 900 − 893 = 7
    const r = await selectLeadsForDetails({ nichoId: 'n', nichoTermos: T })
    expect(r.saldo).toBe(7); expect(r.selecionados).toHaveLength(7); expect(r.aguardando).toBe(53)
  })

  it('Details bloqueado (sem orçamento configurado) → seleciona ZERO e não enfileira nada', async () => {
    Object.assign(env, { GOOGLE_PLACE_DETAILS_ENTERPRISE_MONTHLY_BUDGET: undefined })
    mocks.prisma.prospect.findMany.mockResolvedValue([lead('1'), lead('2')])
    const r = await selectLeadsForDetails({ nichoId: 'n', nichoTermos: T })
    expect(r).toMatchObject({ selecionados: [], saldo: null, limite: 0 })
  })

  it('duplicados (mesmo nome+endereço) pagam UM Details só; quem já tem Details vigente nunca é selecionado de novo', async () => {
    mocks.prisma.prospect.findMany.mockResolvedValue([lead('1', { arenaName: 'Arena Tribo' }), lead('2', { arenaName: 'ARENA  TRIBO!', address: 'Rua 1, 10 - Centro, Tubarão - SC' }), lead('3'), lead('4')])
    mocks.prisma.leadEvidence.findMany.mockResolvedValue([{ prospectId: '3' }])
    const r = await selectLeadsForDetails({ nichoId: 'n', nichoTermos: T })
    expect(r.ignorados).toEqual({ duplicados: 1, jaComDetails: 1 })
    expect(r.selecionados).toHaveLength(2)
    expect(r.selecionados).not.toContain('3')
    const where = mocks.prisma.leadEvidence.findMany.mock.calls[0][0].where
    expect(where).toMatchObject({ source: 'GOOGLE', type: 'PLACE_FIELDS' }) // a vigência é checada pela evidência real
  })

  it('só lead com placeId e fora de PROCESSING entra na consulta; ids manuais restringem a seleção', async () => {
    mocks.prisma.prospect.findMany.mockResolvedValue([])
    await selectLeadsForDetails({ nichoId: 'n', nichoTermos: T, ids: ['a', 'b'] })
    const where = mocks.prisma.prospect.findMany.mock.calls[0][0].where
    expect(where).toMatchObject({ nichoId: 'n', placeId: { not: null }, id: { in: ['a', 'b'] } })
    expect(JSON.stringify(where.OR)).toContain('PROCESSING')
  })

  it('enfileirar coloca os selecionados em PENDING com a próxima ação GOOGLE_DETAILS (e acorda o worker)', async () => {
    await enqueueDetails(['1', '2'])
    expect(mocks.prisma.prospect.updateMany.mock.calls[0][0]).toMatchObject({ where: { id: { in: ['1', '2'] } }, data: { investigationState: 'PENDING', investigationNextAction: 'GOOGLE_DETAILS', investigationAttempts: 0 } })
    expect(mocks.kick).toHaveBeenCalled()
    mocks.kick.mockClear(); await enqueueDetails([])
    expect(mocks.kick).not.toHaveBeenCalled()
  })
})
