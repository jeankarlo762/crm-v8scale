import { describe, it, expect, vi, beforeEach } from 'vitest'
import { phoneKey } from './lead-dedupe.service'

describe('phoneKey', () => {
  it('formatos diferentes do mesmo telefone geram a mesma chave', () => {
    expect(phoneKey('+55 48 99103-1021')).toBe(phoneKey('(48) 99103-1021'))
    expect(phoneKey('(48) 99103-1021')).toBe(phoneKey('48991031021'))
  })
})

// Integração com buscarLeads: prisma e Places mockados.
const mocks = vi.hoisted(() => ({
  prisma: {
    nicho: { findUnique: vi.fn() },
    buscaLog: { create: vi.fn() },
    prospect: { findMany: vi.fn(), createMany: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    leadEvidence: { findMany: vi.fn().mockResolvedValue([]) }, // selectLeadsForDetails consulta a evidência vigente do Google
  },
  searchPlaces: vi.fn(),
}))
vi.mock('../config/database', () => ({ prisma: mocks.prisma }))
vi.mock('./places.service', async (orig) => ({ ...(await orig<typeof import('./places.service')>()), searchPlaces: mocks.searchPlaces }))
vi.mock('./site-classify-queue.service', () => ({ enqueueManySiteClassify: vi.fn(), enqueueSiteClassify: vi.fn(), leadPriority: () => 0 }))

describe('buscarLeads: dedupe só por placeId; mesmo telefone é salvo e agrupado', () => {
  beforeEach(() => vi.clearAllMocks())

  it('mesmo telefone com placeIds diferentes entra todo; placeId já existente não é recriado', async () => {
    const { buscarLeads } = await import('./lead.service')
    const place = (placeId: string, telefone: string | null) => ({
      placeId, nome: placeId, endereco: null, addressComponents: null, telefone, website: null, avaliacao: 4, numAvaliacoes: 10,
    })
    mocks.prisma.nicho.findUnique.mockResolvedValue({ id: 'n1', nome: 'Pousada' })
    mocks.searchPlaces.mockResolvedValue([
      place('p1', '(48) 99103-1021'), // placeId já salvo
      place('p2', '(48) 98888-0000'),
      place('p3', '48988880000'), // mesmo telefone do p2, outro placeId
    ])
    mocks.prisma.prospect.findMany.mockImplementation(async (args: { where?: { placeId?: { in?: string[] } } }) =>
      args.where?.placeId ? [{ id: 'l1', placeId: 'p1', website: null, arenaName: 'Pousada', address: null, primaryType: null, city: null, state: null, createdAt: new Date(0) }] : [])
    mocks.prisma.prospect.createMany.mockImplementation(async ({ data }: { data: unknown[] }) => ({ count: data.length }))

    const r = await buscarLeads('n1', 'Laguna - SC')
    expect(r).toMatchObject({ encontrados: 3, novos: 2, duplicados: 1 })
    expect(mocks.prisma.prospect.createMany.mock.calls[0][0].data.map((d: { placeId: string }) => d.placeId)).toEqual(['p2', 'p3'])
  })
})

describe('buscarLeads: placeId existente atualiza os campos do Google', () => {
  beforeEach(() => vi.clearAllMocks())

  const place = {
    placeId: 'p1', nome: 'Pousada Sol', endereco: 'Rua A, 10 - Centro, Laguna - SC', telefone: '(48) 99908-7963',
    telefoneInternacional: '+55 48 99908-7963', website: 'https://pousadasol.com.br', avaliacao: 4.7, numAvaliacoes: 210,
    addressComponents: [{ longText: 'Laguna', shortText: 'Laguna', types: ['administrative_area_level_2'] }],
  }

  async function run(existingWebsite: string | null) {
    const { buscarLeads } = await import('./lead.service')
    mocks.prisma.nicho.findUnique.mockResolvedValue({ id: 'n1', nome: 'Pousada' })
    mocks.searchPlaces.mockResolvedValue([place])
    mocks.prisma.prospect.findMany.mockImplementation(async (args: { where?: { placeId?: unknown } }) =>
      args.where?.placeId ? [{ id: 'lead1', placeId: 'p1', website: existingWebsite, arenaName: 'Pousada', address: null, primaryType: null, city: null, state: null, createdAt: new Date(0) }] : [])
    mocks.prisma.prospect.createMany.mockResolvedValue({ count: 0 })
    return buscarLeads('n1', 'Laguna - SC')
  }

  it('atualiza telefone, E.164, endereço, site e nota, sem tocar em status, responsável e notas', async () => {
    const r = await run('https://pousadasol.com.br')
    expect(r).toMatchObject({ novos: 0, atualizados: 1 })
    const call = mocks.prisma.prospect.update.mock.calls[0][0]
    expect(call.where).toEqual({ id: 'lead1' })
    expect(call.data).toMatchObject({
      whatsapp: '(48) 99908-7963', phoneE164: '+5548999087963', phoneCountry: 'BR', phoneMobile: true,
      address: place.endereco, addressComponents: place.addressComponents, avaliacao: 4.7, numAvaliacoes: 210,
    })
    for (const campo of ['status', 'responsavel', 'notes', 'nichoId', 'statusSite']) expect(call.data).not.toHaveProperty(campo)
    expect(call.data).not.toHaveProperty('website') // site igual: nada a escrever
    expect(call.data).not.toHaveProperty('verificadoEm') // site igual: não reclassifica
    expect(mocks.prisma.prospect.createMany.mock.calls[0][0].data).toEqual([])
  })

  it('site que mudou zera verificadoEm pra reclassificar', async () => {
    await run('https://antigo.com.br')
    expect(mocks.prisma.prospect.update.mock.calls[0][0].data).toMatchObject({ website: 'https://pousadasol.com.br', verificadoEm: null })
  })

  it('campos que o Google não devolveu não apagam o que já existe', async () => {
    const { googleFieldsUpdate } = await import('./lead.service')
    const data = googleFieldsUpdate({ ...place, telefone: null, telefoneInternacional: null, addressComponents: null, endereco: null, avaliacao: null, numAvaliacoes: null })
    expect(Object.keys(data)).toEqual(['website'])
  })

  it('lead com website e nova chamada sem websiteUri: website permanece (não entra no update)', async () => {
    const { googleFieldsUpdate } = await import('./lead.service')
    expect(googleFieldsUpdate({ ...place, website: null }, 'https://pousadasol.com.br')).not.toHaveProperty('website')
    expect(googleFieldsUpdate({ ...place, website: '' }, 'https://pousadasol.com.br')).not.toHaveProperty('website')
  })


  it('websiteUri ausente na nova busca não apaga website, nem reclassifica, nem toca no enriquecimento', async () => {
    const { buscarLeads } = await import('./lead.service')
    mocks.prisma.nicho.findUnique.mockResolvedValue({ id: 'n1', nome: 'Pousada' })
    mocks.searchPlaces.mockResolvedValue([{ ...place, website: null }])
    mocks.prisma.prospect.findMany.mockImplementation(async (args: { where?: { placeId?: unknown } }) =>
      args.where?.placeId ? [{ id: 'lead1', placeId: 'p1', website: 'https://pousadasol.com.br', arenaName: 'Pousada', address: null, primaryType: null, city: null, state: null, createdAt: new Date(0) }] : [])
    mocks.prisma.prospect.createMany.mockResolvedValue({ count: 0 })
    await buscarLeads('n1', 'Laguna - SC')
    const data = mocks.prisma.prospect.update.mock.calls[0][0].data
    for (const campo of ['website', 'verificadoEm', 'foundWebsite', 'foundSiteStatus', 'foundWebsiteSource', 'foundWebsiteVerificar', 'instagramHandle', 'instagramVerificar', 'enrichedAt', 'instagram']) {
      expect(data).not.toHaveProperty(campo)
    }
  })
})
