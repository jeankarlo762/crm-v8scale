import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({ prisma: { prospect: { findMany: vi.fn(), update: vi.fn(), count: vi.fn() } } }))
vi.mock('../config/database', () => ({ prisma: mocks.prisma }))
import { syncOwnerGroups, withOwnerGroups } from './owner-group.service'

const lead = (id: string, extra = {}) => ({ id, arenaName: id, phoneE164: '+5548999087963', ownerGroupId: null, avaliacao: 4, numAvaliacoes: 100, statusSite: 'sem_site', siteStatus: null, whatsapp: '48999087963', instagram: null, instagramHandle: null, foundWebsite: null, foundSiteStatus: null, phoneMobile: true, ...extra })

describe('owner group', () => {
  beforeEach(() => vi.clearAllMocks())

  it('2+ leads com o mesmo telefone recebem o mesmo ownerGroupId (agrupamento informativo), sem bônus de dono no score', async () => {
    mocks.prisma.prospect.findMany.mockResolvedValue([lead('a'), lead('b')])
    await syncOwnerGroups(['+5548999087963', '+5548999087963'])
    const calls = mocks.prisma.prospect.update.mock.calls.map((c) => c[0].data)
    expect(calls).toHaveLength(2)
    expect(new Set(calls.map((d) => d.ownerGroupId))).toEqual(new Set(['tel:+5548999087963']))
    mocks.prisma.prospect.findMany.mockResolvedValue([lead('a')])
    await syncOwnerGroups(['+5548999087963'])
    const solo = mocks.prisma.prospect.update.mock.calls[2][0].data
    expect(solo.ownerGroupId).toBeNull()
    expect(calls[0].leadScore - solo.leadScore).toBe(0) // contato compartilhado não prova mesmo dono: não vira bônus
  })

  it('lead sozinho perde o grupo (ex.: vizinho removido)', async () => {
    mocks.prisma.prospect.findMany.mockResolvedValue([lead('a', { ownerGroupId: 'tel:+5548999087963' })])
    await syncOwnerGroups(['+5548999087963'])
    expect(mocks.prisma.prospect.update.mock.calls[0][0].data.ownerGroupId).toBeNull()
  })

  it('withOwnerGroups devolve tamanho e nomes dos outros negócios', async () => {
    mocks.prisma.prospect.findMany.mockResolvedValue([
      { id: 'a', ownerGroupId: 'g', arenaName: 'Pousada A' }, { id: 'b', ownerGroupId: 'g', arenaName: 'Pousada B' },
    ])
    const [a, solo] = await withOwnerGroups([{ id: 'a', ownerGroupId: 'g' }, { id: 'c', ownerGroupId: null }])
    expect(a).toMatchObject({ ownerGroupSize: 2, ownerGroupNames: ['Pousada B'] })
    expect(solo).toMatchObject({ ownerGroupSize: 1, ownerGroupNames: [] })
  })
})
