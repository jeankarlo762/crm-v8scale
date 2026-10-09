import { describe, it, expect, vi, beforeEach } from 'vitest'

const db = vi.hoisted(() => ({ customer: { findFirst: vi.fn(), update: vi.fn() } }))
vi.mock('../config/database', () => ({ prisma: db }))

import { archiveCustomer, unarchiveCustomer } from './customer-archive.service'

describe('arquivar cliente', () => {
  beforeEach(() => { vi.clearAllMocks(); db.customer.update.mockImplementation(async ({ data }) => data) })

  it('cliente ativo: arquiva, inativa e marca churnedAt == archivedAt', async () => {
    db.customer.findFirst.mockResolvedValue({ id: 'c1', active: true, archivedAt: null })
    await archiveCustomer('c1', '  duplicado  ')
    const { data } = db.customer.update.mock.calls[0][0]
    expect(data.active).toBe(false)
    expect(data.archiveReason).toBe('duplicado')
    expect(data.churnedAt).toBe(data.archivedAt)
  })

  it('cliente que já tinha cancelado: arquiva sem mexer no churnedAt original', async () => {
    db.customer.findFirst.mockResolvedValue({ id: 'c1', active: false, archivedAt: null })
    await archiveCustomer('c1', undefined)
    const { data } = db.customer.update.mock.calls[0][0]
    expect(data).not.toHaveProperty('churnedAt')
    expect(data).not.toHaveProperty('active')
    expect(data.archiveReason).toBeNull()
  })

  it('já arquivado ou inexistente: erro', async () => {
    db.customer.findFirst.mockResolvedValueOnce({ id: 'c1', active: false, archivedAt: new Date() })
    await expect(archiveCustomer('c1', null)).rejects.toMatchObject({ statusCode: 409 })
    db.customer.findFirst.mockResolvedValueOnce(null)
    await expect(archiveCustomer('x', null)).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe('desarquivar cliente', () => {
  beforeEach(() => { vi.clearAllMocks(); db.customer.update.mockImplementation(async ({ data }) => data) })

  it('inativado pelo arquivamento: volta a ficar ativo', async () => {
    const at = new Date('2026-10-08T12:00:00.000Z')
    db.customer.findFirst.mockResolvedValue({ id: 'c1', active: false, archivedAt: at, churnedAt: new Date(at) })
    await unarchiveCustomer('c1')
    expect(db.customer.update.mock.calls[0][0].data).toMatchObject({ archivedAt: null, archiveReason: null, active: true, churnedAt: null })
  })

  it('já tinha cancelado antes de arquivar: continua inativo, mantém a data do cancelamento', async () => {
    db.customer.findFirst.mockResolvedValue({ id: 'c1', active: false, archivedAt: new Date('2026-10-08T12:00:00Z'), churnedAt: new Date('2026-08-01T00:00:00Z') })
    await unarchiveCustomer('c1')
    const { data } = db.customer.update.mock.calls[0][0]
    expect(data).toMatchObject({ archivedAt: null })
    expect(data).not.toHaveProperty('active')
    expect(data).not.toHaveProperty('churnedAt')
  })

  it('não arquivado: erro 409', async () => {
    db.customer.findFirst.mockResolvedValue({ id: 'c1', active: true, archivedAt: null, churnedAt: null })
    await expect(unarchiveCustomer('c1')).rejects.toMatchObject({ statusCode: 409 })
  })
})
