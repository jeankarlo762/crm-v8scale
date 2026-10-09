import { describe, it, expect, vi } from 'vitest'
import { classifyDomain, isInstitutionalDomain, sameRegistrableDomain } from './domain-classifier.service'
import { rejectFoundSite, rejectInstagramHandle } from './found-site-rules.service'
import { classifySite } from './site-kind.service'
import { computeLeadScore, SCORE_WEIGHTS, type ScoreInput } from './lead-score.service'
import { mapLegacyStatusSite, remapLegacyStatusSite, STATUS_SITE_LEGADO } from './status-site-legacy.service'
import { listLeadsQuerySchema } from '../schemas/lead.schema'

describe('1. mesmo site do Google pelo domínio registrável', () => {
  it.each([
    ['https://www.laplagegaropaba.com.br', 'laplagegaropaba.com.br'],
    ['https://lobohotel.com.br', 'http://www.lobohotel.com.br/'],
    ['https://reservas.pousadacanoaazul.com.br', 'https://pousadacanoaazul.com.br'],
    ['http://www.pousadadosolgaropaba.com.br', 'https://pousadadosolgaropaba.com.br/quartos'],
  ])('%s = %s', (a, b) => {
    expect(sameRegistrableDomain(a, b)).toBe(true)
  })
  it('domínios diferentes não são o mesmo', () => {
    expect(sameRegistrableDomain('https://a.hotels-brazil.net', 'https://b.hotels-brazil.com')).toBe(false)
    expect(sameRegistrableDomain(null, 'https://x.com')).toBe(false)
  })
  it('foundWebsite igual ao websiteUri é rejeitado (não vira "não cadastrado no Google")', () => {
    const lead = { arenaName: 'Lobo Hotel', city: 'Garopaba', state: 'SC', website: 'http://www.lobohotel.com.br/' }
    expect(rejectFoundSite('https://lobohotel.com.br', lead)).toBe('mesmo_site_google')
  })
})

describe('2. reaplica as regras a dados já salvos', () => {
  const laguna = { arenaName: 'Pousada Laguna', city: 'Laguna', state: 'SC' }
  it('pousadalagunapb.com.br sai; pousadalaguna.com.br fica', () => {
    expect(rejectFoundSite('https://pousadalagunapb.com.br', laguna)).toBe('outro_estado')
    expect(rejectFoundSite('https://pousadalaguna.com.br', laguna)).toBeNull()
  })
  it('@ com outro estado colado à cidade sai', () => {
    expect(rejectInstagramHandle('pousadalagunapb', laguna)).toBe('outro_estado')
    expect(rejectInstagramHandle('pousadalaguna', laguna)).toBeNull()
  })
  it('reaplica blocklist, agregador e similaridade', () => {
    const l = { arenaName: 'Pousada Sol', city: 'Garopaba', state: 'SC' }
    expect(rejectFoundSite('https://www.booking.com', l)).toBe('bloqueio')
    expect(rejectFoundSite('https://www.facebook.com/x', l)).toBe('rede_social')
    expect(rejectFoundSite('https://hotels-brazil.net', l)).toBe('bloqueio')
    expect(rejectFoundSite('https://viagensbrasil.com.br', l)).toBe('agregador')
    expect(rejectFoundSite('https://outronome.com.br', l)).toBe('sem_relacao')
    expect(rejectFoundSite('https://pousadasol.com.br', l)).toBeNull()
  })
})

describe('3. governo e instituições', () => {
  it.each(['santaterezinha.mt.gov.br', 'tjsc.jus.br', 'alesc.leg.br', 'mpsc.mp.br', 'ufsc.edu.br'])('%s é institucional', (h) => {
    expect(isInstitutionalDomain(h)).toBe(true)
    expect(rejectFoundSite(`https://${h}`, { arenaName: 'Pousada Santa Terezinha', city: 'Garopaba', state: 'SC' })).toMatch(/institucional|outro_estado/)
  })
  it('sigla de outro estado no domínio', () => {
    expect(rejectFoundSite('https://santaterezinha.mt.gov.br', { arenaName: 'Pousada Santa Terezinha', city: 'Garopaba', state: 'SC' })).toBe('institucional')
    expect(rejectFoundSite('https://pousadax.mt.com.br', { arenaName: 'Pousada X', city: 'Garopaba', state: 'SC' })).toBe('outro_estado')
  })
})

describe('4. websiteUri do dono não é rebaixado por essas regras', () => {
  it('site .gov.br/.edu.br cadastrado no Google continua site próprio', () => {
    expect(classifyDomain('arena.sc.gov.br')).toBe('candidato')
    expect(classifySite('https://arena.sc.gov.br').kind).toBe('site_proprio')
  })
  it('domínio sem relação com o nome cadastrado no Google continua site próprio', () => {
    expect(classifySite('https://qualquercoisa.com.br').kind).toBe('site_proprio')
  })
  it('a blocklist de plataformas continua valendo para o websiteUri (Booking = Só Booking)', () => {
    expect(classifySite('https://www.booking.com/hotel/br/x.html').kind).toBe('so_ota')
    expect(classifySite('https://www.econodata.com.br/x').kind).toBe('so_ota')
  })
})

describe('5. score: fixo e sem telefone', () => {
  const base: ScoreInput = { avaliacao: 4, numAvaliacoes: 10, statusSite: 'sem_site', siteStatus: null, whatsapp: '48999999999', instagram: null, instagramHandle: null, foundWebsite: null, foundSiteStatus: null, phoneMobile: null }
  it('penalidadeFixo = 4', () => {
    expect(SCORE_WEIGHTS.penalidadeFixo).toBe(4)
    expect(computeLeadScore(base) - computeLeadScore({ ...base, phoneMobile: false })).toBe(4)
  })
  it('sem telefone com Instagram confirmado: -5; sem Instagram: penalidade máxima', () => {
    const semTel = { ...base, whatsapp: null }
    const comIg = computeLeadScore({ ...semTel, instagramHandle: 'x', instagramVerificar: false })
    const semIg = computeLeadScore(semTel)
    expect(computeLeadScore({ ...base, instagramHandle: 'x' }) - comIg).toBe(5)
    expect(semIg).toBeLessThan(-900)
    expect(computeLeadScore({ ...semTel, instagramHandle: 'x', instagramVerificar: true })).toBeLessThan(-900) // sugestão não conta
  })
})

const mocks = vi.hoisted(() => ({ prisma: { prospect: { findMany: vi.fn(), update: vi.fn(), count: vi.fn() } } }))
vi.mock('../config/database', () => ({ prisma: mocks.prisma }))

describe('6. ownerGroupId só para celulares', () => {
  const lead = (id: string, mobile: boolean) => ({ id, arenaName: id, phoneE164: '+554836451021', ownerGroupId: null, avaliacao: 4, numAvaliacoes: 100, statusSite: 'sem_site', siteStatus: null, whatsapp: '4836451021', instagram: null, instagramHandle: null, foundWebsite: null, foundSiteStatus: null, phoneMobile: mobile })
  it('fixo repetido não agrupa; celular repetido agrupa', async () => {
    const { syncOwnerGroups } = await import('./owner-group.service')
    mocks.prisma.prospect.findMany.mockResolvedValueOnce([lead('a', false), lead('b', false)])
    await syncOwnerGroups(['+554836451021'])
    expect(mocks.prisma.prospect.update.mock.calls.map((c) => c[0].data.ownerGroupId)).toEqual([null, null])
    mocks.prisma.prospect.update.mockClear()
    mocks.prisma.prospect.findMany.mockResolvedValueOnce([lead('a', true), lead('b', true)])
    await syncOwnerGroups(['+554836451021'])
    expect(mocks.prisma.prospect.update.mock.calls.map((c) => c[0].data.ownerGroupId)).toEqual(['tel:+554836451021', 'tel:+554836451021'])
  })
})

describe('8. statusSite antigo: aceito e remapeado no boot, de forma idempotente', () => {
  it('mapeia os valores antigos sem perder dados', () => {
    expect(mapLegacyStatusSite('so_plataforma', null)).toBe('so_ota')
    expect(mapLegacyStatusSite('site_quebrado', null)).toBe('fora_do_ar')
    expect(mapLegacyStatusSite('sem_nada', null)).toBe('sem_site')
    expect(mapLegacyStatusSite('so_redes', 'https://instagram.com/x')).toBe('so_instagram')
    expect(mapLegacyStatusSite('so_link_rede', 'https://www.facebook.com/x')).toBe('so_facebook')
    expect(mapLegacyStatusSite('redireciona_rede', 'https://linktr.ee/x')).toBe('link_bio')
    expect(mapLegacyStatusSite('site_proprio', null)).toBe('site_proprio') // valor novo não muda
  })
  it('remap atualiza só os antigos; segunda rodada não muda nada', async () => {
    const rows = [
      { id: '1', statusSite: 'so_plataforma', siteUrl: null, destinoReal: null },
      { id: '2', statusSite: 'so_redes', siteUrl: null, destinoReal: 'https://instagram.com/a' },
    ]
    const db = { prospect: { findMany: vi.fn().mockResolvedValueOnce(rows).mockResolvedValueOnce([]), updateMany: vi.fn() } }
    expect(await remapLegacyStatusSite(db as never)).toBe(2)
    expect(db.prospect.updateMany.mock.calls.map((c) => [c[0].where.id.in, c[0].data.statusSite])).toEqual([[['1'], 'so_ota'], [['2'], 'so_instagram']])
    expect(await remapLegacyStatusSite(db as never)).toBe(0)
    expect(db.prospect.updateMany).toHaveBeenCalledTimes(2)
    expect(db.prospect.findMany.mock.calls[0][0].where.statusSite.in).toEqual([...STATUS_SITE_LEGADO])
  })
  it('o filtro da API continua aceitando os valores antigos', () => {
    expect(listLeadsQuerySchema.parse({ nichoId: 'n', statusSite: 'so_redes,sem_site' }).statusSite).toEqual(['so_redes', 'sem_site'])
  })
})
