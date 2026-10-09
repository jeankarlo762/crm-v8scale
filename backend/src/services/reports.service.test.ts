import { describe, it, expect, vi, beforeEach } from 'vitest'

const db = vi.hoisted(() => ({
  campaign: { findMany: vi.fn(), findUnique: vi.fn() },
  campaignRecipient: { findMany: vi.fn() },
  stage: { findMany: vi.fn() },
  lead: { findMany: vi.fn() },
  activity: { findMany: vi.fn() },
  user: { findMany: vi.fn() },
  $queryRaw: vi.fn(),
  $executeRaw: vi.fn(),
}))
vi.mock('../config/database', () => ({ prisma: db }))

import { campaignsReport, funnelReport, parsePeriod } from './reports.service'
import { phoneKey, registerReply } from './campaign-replies.service'

const d = (s: string) => new Date(s)

describe('relatório de campanhas', () => {
  beforeEach(() => vi.clearAllMocks())

  it('conta enviados, respostas, taxa de resposta e conversão em lead por campanha e no total', async () => {
    db.campaign.findMany.mockResolvedValue([
      { id: 'c1', name: 'Lojas SC', status: 'DONE', nichoNome: 'Concessionárias', estado: 'SC', cidade: null, selecionados: false, createdAt: d('2026-10-01T12:00:00Z'), responsavelId: 'u1', responsavel: { id: 'u1', name: 'Ana' } },
      { id: 'c2', name: 'Sem dono', status: 'DRAFT', nichoNome: null, estado: null, cidade: null, selecionados: true, createdAt: d('2026-10-02T12:00:00Z'), responsavelId: null, responsavel: null },
    ])
    const won = { value: 1200, stage: { kind: 'WON' } }
    db.campaignRecipient.findMany.mockResolvedValue([
      { campaignId: 'c1', status: 'SENT', sentAt: d('2026-10-01T13:00:00Z'), repliedAt: d('2026-10-01T14:00:00Z'), replyCount: 3, prospect: { status: 'fechado', convertedLead: won } },
      { campaignId: 'c1', status: 'SENT', sentAt: d('2026-10-01T13:05:00Z'), repliedAt: null, replyCount: 0, prospect: { status: 'contato_1', convertedLead: null } },
      { campaignId: 'c1', status: 'SENT', sentAt: d('2026-10-01T13:10:00Z'), repliedAt: d('2026-10-02T13:10:00Z'), replyCount: 1, prospect: { status: 'negociando', convertedLead: { value: 500, stage: { kind: 'OPEN' } } } },
      { campaignId: 'c1', status: 'FAILED', sentAt: null, repliedAt: null, replyCount: 0, prospect: null },
      { campaignId: 'c2', status: 'PENDING', sentAt: null, repliedAt: null, replyCount: 0, prospect: null },
    ])
    const r = await campaignsReport({})
    const c1 = r.campaigns.find((c) => c.id === 'c1')!
    expect(c1).toMatchObject({ total: 4, sent: 3, failed: 1, replied: 2, replies: 4, negotiating: 1, closed: 1, leads: 2, leadsWon: 1, wonValue: 1200 })
    expect(c1.replyRate).toBeCloseTo(66.7, 1)
    expect(r.totals).toMatchObject({ campaigns: 2, sent: 3, replied: 2, pending: 1 })
    expect(r.byUser.map((u) => [u.name, u.replied])).toEqual([['Ana', 2], ['Sem responsável', 0]])
    expect(r.series.find((s) => s.day === '2026-10-01')).toMatchObject({ enviadas: 3, respostas: 1 })
  })

  it('sem campanhas no filtro: não consulta destinatários e devolve zeros', async () => {
    db.campaign.findMany.mockResolvedValue([])
    const r = await campaignsReport({})
    expect(r.totals).toMatchObject({ campaigns: 0, sent: 0, replied: 0, replyRate: 0 })
    expect(db.campaignRecipient.findMany).not.toHaveBeenCalled()
  })
})

describe('respostas da campanha', () => {
  beforeEach(() => vi.clearAllMocks())

  it('compara telefones pelos 8 últimos dígitos (ignora DDI, DDD e o 9º dígito)', () => {
    expect(phoneKey('+55 (48) 99912-3456')).toBe(phoneKey('554899123456'))
    expect(phoneKey('5548999123456')).toBe(phoneKey('554899123456'))
  })

  it('número que não recebeu campanha na janela não é atribuído', async () => {
    db.$queryRaw.mockResolvedValue([])
    expect(await registerReply('5548999123456')).toBeNull()
    expect(db.$executeRaw).not.toHaveBeenCalled()
  })

  it('atribui ao envio mais recente e incrementa a resposta', async () => {
    db.$queryRaw.mockResolvedValue([{ id: 'r9' }])
    expect(await registerReply('5548999123456')).toBe('r9')
    expect(db.$executeRaw).toHaveBeenCalledTimes(1)
  })

  it('telefone curto demais é ignorado', async () => {
    expect(await registerReply('123')).toBeNull()
    expect(db.$queryRaw).not.toHaveBeenCalled()
  })
})

describe('relatório do funil', () => {
  it('conta leads/valor por etapa, parados e entradas no período pelo texto "A → B"', async () => {
    const old = new Date(Date.now() - 30 * 86_400_000)
    db.stage.findMany.mockResolvedValue([
      { id: 's1', name: 'Novo', color: '#000', kind: 'OPEN', position: 0 },
      { id: 's2', name: 'Ganho', color: '#0f0', kind: 'WON', position: 1 },
    ])
    db.lead.findMany.mockResolvedValue([
      { stageId: 's1', value: 100, ownerId: 'u1', stageChangedAt: old, createdAt: old },
      { stageId: 's1', value: 50, ownerId: 'u1', stageChangedAt: new Date(), createdAt: new Date() },
      { stageId: 's2', value: 900, ownerId: 'u1', stageChangedAt: new Date(), createdAt: old },
    ])
    db.activity.findMany.mockResolvedValue([{ content: 'Novo → Ganho' }, { content: 'Novo → Perdido · Motivo: preço' }])
    db.user.findMany.mockResolvedValue([{ id: 'u1', name: 'Ana' }])
    const r = await funnelReport({})
    expect(r.stages[0]).toMatchObject({ count: 2, value: 150, stuck: 1, share: 66.7 })
    expect(r.stages[1]).toMatchObject({ count: 1, value: 900, enteredInPeriod: 1 })
    expect(r.totals).toMatchObject({ leads: 3, open: 2, won: 1, stuck: 1, movesInPeriod: 2 })
    expect(r.owners[0]).toMatchObject({ label: 'Ana', total: 3 })
  })
})

describe('período', () => {
  it('interpreta datas em Brasília (início e fim do dia)', () => {
    const p = parsePeriod('2026-10-01', '2026-10-02')
    expect(p.from?.toISOString()).toBe('2026-10-01T03:00:00.000Z')
    expect(p.to?.toISOString()).toBe('2026-10-03T02:59:59.999Z')
  })
})
