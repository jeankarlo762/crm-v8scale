import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const db = vi.hoisted(() => ({
  campaign: { findMany: vi.fn(() => Promise.resolve([])), findUnique: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
  campaignRecipient: { findFirst: vi.fn(), update: vi.fn() },
  prospect: { findUnique: vi.fn(), updateMany: vi.fn() },
}))
const wa = vi.hoisted(() => ({ status: 'disconnected', sendMessage: vi.fn() }))
vi.mock('../config/database', () => ({ prisma: db }))
vi.mock('./baileys.service', () => ({
  getInfo: () => ({ status: wa.status, qr: null }),
  sendMessage: wa.sendMessage,
  onIncomingMessage: () => {},
}))

import { _dispatchLoopForTests } from './campaign.service'

const campaign = { id: 'c1', status: 'RUNNING', publico: 'todos', messages: JSON.stringify(['Oi {{nome}}']), selecionados: false, targetStatus: 'nao_contatado', area: null, responsavelId: null, delayMinSec: 0, delayMaxSec: 0 }
const recipient = { id: 'r1', campaignId: 'c1', prospectId: null, name: 'Arena X', phone: '+5548999123456', status: 'PENDING' }

describe('disparo da campanha com WhatsApp fora do ar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    db.campaign.findMany.mockResolvedValue([])
    db.campaign.findUnique.mockResolvedValue(campaign)
    db.campaign.updateMany.mockResolvedValue({ count: 1 })
    db.campaignRecipient.findFirst.mockResolvedValue(recipient)
    db.campaignRecipient.update.mockResolvedValue({})
  })
  afterEach(() => vi.useRealTimers())

  it('desconectado: pausa a campanha e NÃO marca o destinatário como falhou', async () => {
    wa.status = 'disconnected'
    const run = _dispatchLoopForTests('c1')
    await vi.advanceTimersByTimeAsync(61_000)
    await run
    expect(db.campaign.updateMany).toHaveBeenCalledWith({ where: { id: 'c1', status: 'RUNNING' }, data: { status: 'PAUSED' } })
    expect(wa.sendMessage).not.toHaveBeenCalled()
    expect(db.campaignRecipient.update).not.toHaveBeenCalled()
  })

  it('caiu entre a checagem e o envio: mantém o destinatário na fila e pausa', async () => {
    wa.status = 'connected'
    wa.sendMessage.mockResolvedValue({ ok: false, error: 'WhatsApp não conectado (status=disconnected)' })
    await _dispatchLoopForTests('c1')
    expect(db.campaignRecipient.update).not.toHaveBeenCalled()
    expect(db.campaign.updateMany).toHaveBeenCalledWith({ where: { id: 'c1', status: 'RUNNING' }, data: { status: 'PAUSED' } })
  })

  it('conectado: envia e marca como enviado', async () => {
    wa.status = 'connected'
    wa.sendMessage.mockResolvedValue({ ok: true })
    db.campaignRecipient.findFirst.mockResolvedValueOnce(recipient).mockResolvedValueOnce(null)
    const run = _dispatchLoopForTests('c1')
    await vi.advanceTimersByTimeAsync(100) // intervalo entre envios (0 s no teste)
    await run
    expect(db.campaignRecipient.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'SENT' }) }))
  })
})
