// Integração com Postgres REAL: reserva atômica sob concorrência, claim/lease da fila e retomada.
// Roda só com TEST_DATABASE_URL (banco descartável com o schema aplicado: `prisma db push`). Nunca aponte para produção.
//   TEST_DATABASE_URL=postgresql://user@127.0.0.1:5432/arenatest npx vitest run src/services/investigation.db.test.ts
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'

const URL = process.env.TEST_DATABASE_URL
const mocks = vi.hoisted(() => ({ searchPlaces: vi.fn(), sendMessage: vi.fn() }))
vi.mock('./baileys.service', () => ({ sendMessage: mocks.sendMessage, getInfo: () => ({ status: 'connected', qr: null }), onIncomingMessage: () => {} }))
vi.mock('./places.service', async (orig) => ({ ...(await orig<typeof import('./places.service')>()), searchPlaces: mocks.searchPlaces }))
vi.mock('../config/database', async () => {
  const { PrismaClient } = await import('@prisma/client')
  return { prisma: new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL ?? 'postgresql://x@127.0.0.1:1/none' } } }) }
})

import { prisma } from '../config/database'
import { env } from '../config/env'
import { reserve, prismaQuotaStore, setQuotaStore, QuotaRun, getUsage, _resetQuotaForTests } from './api-quota.service'
import { setCacheStore, prismaCacheStore } from './api-guard.service'
import { _resetProviderStateForTests, resumeProvider } from './provider-state.service'
import { enqueueSiteClassify, claimBatch, recoverExpiredLeases, processLead, renewLease, saveEvidenceOwned, startLeaseHeartbeat, _setQueueDepsForTests, INSTANCE_ID } from './site-classify-queue.service'
import { LeaseLostError } from './investigation.service'
import { noWebsiteEligibility } from './no-website-eligibility.service'
import { createCampaign, startCampaign, reviewCampaignAudience, _dispatchLoopForTests } from './campaign.service'
import { reconcileQuotaConfig } from './api-quota.service'
import { URL as NodeURL } from 'node:url'
import { buscarLeads, enriquecerNicho } from './lead.service'
import { CLASSIFIER_VERSION } from './website-types'
import { execFileSync } from 'node:child_process'
import { _setSearchProviderForTests, searchTavily } from './search-enrich.service'
import { extractPageFacts } from './page-facts.service'
import type { InvestigationDeps } from './investigation.service'

const T = { operation: 'SEARCH_BASIC' }
const KEYS = ['GOOGLE_TEXT_SEARCH_PRO', 'GOOGLE_PLACE_DETAILS_ENTERPRISE', 'TAVILY', 'META'].flatMap((p) => ['HOURLY', 'DAILY', 'MONTHLY'].map((w) => `${p}_${w}_BUDGET`))
function budgets(b: Record<string, number>) {
  for (const k of KEYS) (env as Record<string, unknown>)[k] = undefined
  Object.assign(env, b, { API_QUOTA_SAFETY_PERCENT: 0, TAVILY_EXTERNAL_RESERVED: 0, API_OPERATION_BUDGETS: undefined, SEARCH_CACHE_TTL_HOURS: 168, SEARCH_CACHE_NEGATIVE_TTL_HOURS: 168 })
}

function fakeDepsFor(id: string): InvestigationDeps {
  return {
    fetchFacts: async (u) => extractPageFacts({ url: u, finalUrl: u, html: '', httpStatus: 200 }),
    fetchLinks: async () => ({ ok: true, links: [] as string[], instagram: null }),
    search: (q, o) => searchTavily(q, o),
    bio: async () => ({ status: 'NOT_CONFIGURED' as const }),
    google: async (placeId) => ({ status: 'OK' as const, data: { placeId, websiteUri: null, nationalPhone: null, internationalPhone: null, rating: null, userRatingCount: null, collection: 'place-details-enterprise:v1' }, fromCache: false, collectedAt: new Date(), outcome: 'NEGATIVE' as const }),
    save: async (r) => { await saveEvidenceOwnedNoop(id, r) },
    now: () => new Date(),
  }
}
const saveEvidenceOwnedNoop = async (_id: string, _r: unknown) => {} // processLead sempre substitui save por saveEvidenceOwned (token do claim)

describe.skipIf(!URL)('Postgres real', () => {
  beforeAll(async () => { await prisma.$connect() })
  afterAll(async () => { await prisma.$disconnect() })
  beforeEach(async () => {
    _resetQuotaForTests(); _resetProviderStateForTests()
    setQuotaStore(prismaQuotaStore); setCacheStore(prismaCacheStore)
    await prisma.$executeRawUnsafe('TRUNCATE "LeadEvidence","ApiCache","ApiUsage","ApiQuotaConfig","ProviderState","Prospect","Campaign" CASCADE')
    _setSearchProviderForTests(null); _setQueueDepsForTests(null)
  })

  describe('orçamento: reserva atômica', () => {
    it('80 reservas simultâneas com teto diário 25 → exatamente 25 passam (e o mês conta o mesmo)', async () => {
      budgets({ TAVILY_MONTHLY_BUDGET: 100, TAVILY_DAILY_BUDGET: 25 })
      const rs = await Promise.all(Array.from({ length: 80 }, () => reserve('TAVILY', T)))
      expect(rs.filter((r) => r.ok)).toHaveLength(25)
      const u = await getUsage()
      expect(u.usage.TAVILY.janelas.D.usado).toBe(25)
      expect(u.usage.TAVILY.janelas.M.usado).toBe(25)
    })

    it('H, D e M na mesma transação: a janela mais apertada decide e nada é contado a mais nas outras', async () => {
      budgets({ META_HOURLY_BUDGET: 4, META_DAILY_BUDGET: 100 })
      const rs = await Promise.all(Array.from({ length: 30 }, () => reserve('META', { operation: 'BUSINESS_DISCOVERY' })))
      expect(rs.filter((r) => r.ok)).toHaveLength(4)
      const u = await getUsage()
      expect(u.usage.META.janelas.H.usado).toBe(4)
      expect(u.usage.META.janelas.D.usado).toBe(4)
    })

    it('fronteira do mês com Date simulada: teto mensal esgotado reabre no mês seguinte', async () => {
      budgets({ TAVILY_MONTHLY_BUDGET: 2 })
      vi.useFakeTimers({ toFake: ['Date'] })
      try {
        vi.setSystemTime(new Date('2026-10-31T23:59:59.000Z'))
        expect((await reserve('TAVILY', T)).ok).toBe(true)
        expect((await reserve('TAVILY', T)).ok).toBe(true)
        expect((await reserve('TAVILY', T)).ok).toBe(false)
        vi.setSystemTime(new Date('2026-11-01T00:00:00.000Z'))
        expect((await reserve('TAVILY', T)).ok).toBe(true)
      } finally { vi.useRealTimers() }
    })

    it('limite por execução não gasta orçamento do banco', async () => {
      budgets({ TAVILY_MONTHLY_BUDGET: 100 })
      const run = new QuotaRun('x', { TAVILY: 2 })
      const rs = await Promise.all(Array.from({ length: 6 }, () => reserve('TAVILY', { ...T, run })))
      expect(rs.filter((r) => r.ok)).toHaveLength(2)
      expect((await getUsage()).usage.TAVILY.janelas.M.usado).toBe(2)
    })
  })

  describe('fila persistente: claim, lease e recuperação', () => {
    const mk = (over: Record<string, unknown> = {}) => prisma.prospect.create({ data: { arenaName: `Arena ${Math.random().toString(36).slice(2, 7)}`, city: 'Tubarão', state: 'SC', investigationState: 'PENDING', investigationNextRunAt: new Date(Date.now() - 1000), ...over } })

    it('dois workers disputando o mesmo lote nunca pegam o mesmo lead (SKIP LOCKED)', async () => {
      for (let i = 0; i < 24; i++) await mk({ investigationPriority: i })
      const [a, b, c] = await Promise.all([claimBatch(10, 'w1'), claimBatch(10, 'w2'), claimBatch(10, 'w3')])
      const ids = [...a, ...b, ...c].map((x) => x.id)
      expect(new Set(ids).size).toBe(ids.length)
      expect(ids).toHaveLength(24 - (24 - ids.length)) // todos distintos
      expect(ids.length).toBe(24)
      const processing = await prisma.prospect.count({ where: { investigationState: 'PROCESSING' } })
      expect(processing).toBe(24)
    })

    it('só pega quem está na hora (nextRunAt) e respeita a prioridade', async () => {
      const futuro = await mk({ investigationState: 'WAITING_QUOTA', investigationNextRunAt: new Date(Date.now() + 3600_000) })
      const baixa = await mk({ investigationPriority: 1 })
      const alta = await mk({ investigationPriority: 9 })
      const got = await claimBatch(1)
      expect(got[0].id).toBe(alta.id)
      const rest = await claimBatch(5)
      expect(rest.map((r) => r.id)).toEqual([baixa.id])
      expect((await prisma.prospect.findUnique({ where: { id: futuro.id } }))?.investigationState).toBe('WAITING_QUOTA')
    })

    it('lease vencida (worker morreu): volta como WAITING_RETRY e conta tentativa; esgotadas → revisão manual', async () => {
      const a = await mk({ investigationState: 'PROCESSING', investigationLockedBy: 'morto', investigationLockedUntil: new Date(Date.now() - 1000), investigationAttempts: 1 })
      const b = await mk({ investigationState: 'PROCESSING', investigationLockedBy: 'morto', investigationLockedUntil: new Date(Date.now() - 1000), investigationAttempts: env.INVESTIGATION_MAX_ATTEMPTS - 1 })
      const vivo = await mk({ investigationState: 'PROCESSING', investigationLockedBy: 'vivo', investigationLockedUntil: new Date(Date.now() + 60_000) })
      expect(await recoverExpiredLeases()).toBe(2)
      const [ra, rb, rv] = await Promise.all([a, b, vivo].map((x) => prisma.prospect.findUnique({ where: { id: x.id } })))
      expect(ra).toMatchObject({ investigationState: 'WAITING_RETRY', investigationAttempts: 2 })
      expect(rb).toMatchObject({ investigationState: 'MANUAL_REVIEW', investigationNextRunAt: null })
      expect(rv?.investigationState).toBe('PROCESSING')
      expect((await claimBatch(5)).map((x) => x.id)).toEqual([a.id]) // a lease recuperada volta pra fila
    })

    it('enfileirar não derruba lead em processamento; force em processamento fica registrado para o fim da rodada', async () => {
      const l = await mk({ investigationState: 'PROCESSING', investigationLockedBy: 'x', investigationLockedUntil: new Date(Date.now() + 60_000) })
      await enqueueSiteClassify(l.id, true)
      const r = await prisma.prospect.findUnique({ where: { id: l.id } })
      expect(r?.investigationState).toBe('PROCESSING')
      expect(r?.investigationForceAt).not.toBeNull()
    })
  })

  describe('investigação ponta a ponta (HTTP/Tavily/Meta falsos; orçamento, cache e fila reais)', () => {
    const noSite = { ok: true, links: [] as string[], instagram: null }
    function fakeDeps(id: string, over: Partial<InvestigationDeps> = {}): InvestigationDeps {
      return {
        fetchFacts: async (u) => extractPageFacts({ url: u, finalUrl: u, html: '', httpStatus: 200 }),
        fetchLinks: async () => noSite,
        search: (q, o) => searchTavily(q, o),
        bio: async () => ({ status: 'NOT_CONFIGURED' as const }),
        google: async (placeId) => ({ status: 'OK' as const, data: { placeId, websiteUri: null, nationalPhone: null, internationalPhone: null, rating: null, userRatingCount: null, collection: 'place-details-enterprise:v1' }, fromCache: false, collectedAt: new Date(), outcome: 'NEGATIVE' as const }),
        save: async (row) => { await prisma.leadEvidence.upsert({ where: { prospectId_source_type_key: { prospectId: id, source: row.source, type: row.type, key: row.key } }, create: { prospectId: id, source: row.source, type: row.type, key: row.key, value: row.value as object, outcome: row.outcome, fromCache: row.fromCache, collectedAt: row.collectedAt, dependsOn: row.dependsOn, version: row.version }, update: { value: row.value as object, outcome: row.outcome, fromCache: row.fromCache, collectedAt: row.collectedAt } }) },
        now: () => new Date(),
        ...over,
      }
    }
    const searchCalls: string[] = []
    function useDeps(over: Partial<InvestigationDeps> = {}) {
      _setSearchProviderForTests({ search: async (q) => { searchCalls.push(q); return [] } })
      _setQueueDepsForTests({ makeDeps: (id) => fakeDeps(id, over), tavilyConfigured: () => true, metaConfigured: () => false, classify: async () => ({ status: 'sem_site', siteUrl: null, linksEncontrados: {}, fonte: null, siteStatus: null, instagramHandle: null }) })
    }
    const mkLead = (over: Record<string, unknown> = {}) => prisma.prospect.create({ data: { arenaName: 'Arena Tribo', city: 'Tubarão', state: 'SC', placeId: `p-${Math.random()}`, whatsapp: '(48) 99123-4567', phoneE164: '+5548991234567', phoneCountry: 'BR', phoneMobile: true, verificadoEm: new Date(), investigationState: 'PENDING', investigationNextRunAt: new Date(Date.now() - 1000), ...over } })
    const claimOne = async (id: string) => { const c = (await claimBatch(50, INSTANCE_ID)).find((x) => x.id === id); expect(c).toBeDefined(); return c! }

    it('investigação completa sem nenhum candidato → PROBABLY_NO_WEBSITE, DONE, com consultas registradas (nome+cidade+UF e telefone)', async () => {
      budgets({ TAVILY_MONTHLY_BUDGET: 50 }); useDeps(); searchCalls.length = 0
      const l = await mkLead()
      await processLead(await claimOne(l.id), new QuotaRun('t'))
      const r = await prisma.prospect.findUnique({ where: { id: l.id } })
      expect(r).toMatchObject({ websiteStatus: 'PROBABLY_NO_WEBSITE', investigationState: 'DONE', investigationNextRunAt: null })
      expect(searchCalls).toHaveLength(2)
      expect(searchCalls[0]).toBe('Arena Tribo Tubarão SC')
      expect(searchCalls[1]).toContain('(48) 99123-4567')
      expect(await prisma.leadEvidence.count({ where: { prospectId: l.id, type: 'SEARCH_RESULTS' } })).toBe(2)
    })

    it('cota esgotada NUNCA vira "sem site": WAITING_QUOTA com próxima ação e volta ao amanhecer; ao retomar, só a etapa que faltou', async () => {
      budgets({ TAVILY_MONTHLY_BUDGET: 50, TAVILY_DAILY_BUDGET: 1 }); useDeps(); searchCalls.length = 0
      const l = await mkLead()
      await processLead(await claimOne(l.id), new QuotaRun('t'))
      let r = await prisma.prospect.findUnique({ where: { id: l.id } })
      expect(searchCalls).toHaveLength(1) // só havia orçamento para a consulta por nome
      expect(r?.investigationState).toBe('WAITING_QUOTA')
      expect(r?.investigationNextAction).toBe('TAVILY_PHONE')
      expect(r?.investigationWaitReason).toMatch(/TAVILY.*sem orçamento/)
      expect(r?.websiteStatus).toBe('UNKNOWN')
      expect(r?.websiteStatus).not.toBe('PROBABLY_NO_WEBSITE')
      const tomorrow = new Date(); tomorrow.setUTCHours(24, 0, 0, 0)
      expect(r?.investigationNextRunAt?.getTime()).toBe(tomorrow.getTime())
      // dia seguinte (orçamento novo): acorda o lead e refaz SÓ o telefone — o nome vem da evidência/cache
      budgets({ TAVILY_MONTHLY_BUDGET: 50, TAVILY_DAILY_BUDGET: 5 })
      await prisma.prospect.update({ where: { id: l.id }, data: { investigationNextRunAt: new Date(Date.now() - 1000) } })
      await processLead(await claimOne(l.id), new QuotaRun('t2'))
      r = await prisma.prospect.findUnique({ where: { id: l.id } })
      expect(searchCalls).toHaveLength(2)
      expect(searchCalls[1]).toContain('(48) 99123-4567')
      expect(r).toMatchObject({ websiteStatus: 'PROBABLY_NO_WEBSITE', investigationState: 'DONE' })
    })

    it('force respeita o orçamento: sem saldo, refazer não chama o provedor e mantém a decisão anterior', async () => {
      budgets({ TAVILY_MONTHLY_BUDGET: 2 }); useDeps(); searchCalls.length = 0
      const l = await mkLead()
      await processLead(await claimOne(l.id), new QuotaRun('t'))
      expect((await prisma.prospect.findUnique({ where: { id: l.id } }))?.websiteStatus).toBe('PROBABLY_NO_WEBSITE')
      expect(searchCalls).toHaveLength(2)
      await enqueueSiteClassify(l.id, true)
      await prisma.prospect.update({ where: { id: l.id }, data: { investigationNextRunAt: new Date(Date.now() - 1000) } })
      await processLead(await claimOne(l.id), new QuotaRun('t2'))
      const r = await prisma.prospect.findUnique({ where: { id: l.id } })
      expect(searchCalls).toHaveLength(2) // nenhuma chamada nova
      expect(r?.investigationState).toBe('WAITING_QUOTA')
      expect(r?.websiteStatus).toBe('PROBABLY_NO_WEBSITE') // incompleta não derruba decisão anterior vigente
    })

    it('erro técnico → WAITING_RETRY com backoff e tentativas; esgotadas → revisão manual (nunca "sem site")', async () => {
      budgets({ TAVILY_MONTHLY_BUDGET: 50 })
      _setSearchProviderForTests({ search: async () => { throw new Error('boom 500') } })
      _setQueueDepsForTests({ makeDeps: (id) => fakeDeps(id), tavilyConfigured: () => true, metaConfigured: () => false, classify: async () => ({ status: 'sem_site', siteUrl: null, linksEncontrados: {}, fonte: null, siteStatus: null, instagramHandle: null }) })
      const l = await mkLead()
      let last: Awaited<ReturnType<typeof prisma.prospect.findUnique>> = null
      for (let i = 1; i <= env.INVESTIGATION_MAX_ATTEMPTS; i++) {
        await prisma.prospect.update({ where: { id: l.id }, data: { investigationNextRunAt: new Date(Date.now() - 1000), investigationState: i === 1 ? 'PENDING' : 'WAITING_RETRY' } })
        await processLead(await claimOne(l.id), new QuotaRun(`t${i}`))
        last = await prisma.prospect.findUnique({ where: { id: l.id } })
        if (i < env.INVESTIGATION_MAX_ATTEMPTS) { expect(last?.investigationState).toBe('WAITING_RETRY'); expect(last?.investigationAttempts).toBe(i); expect(last!.investigationNextRunAt!.getTime()).toBeGreaterThan(Date.now()) }
      }
      expect(last).toMatchObject({ investigationState: 'MANUAL_REVIEW', investigationNextRunAt: null })
      expect(last?.investigationWaitReason).toContain('RETRIES_EXHAUSTED')
      expect(last?.websiteStatus).toBe('UNKNOWN')
    })

    it('auth inválida pausa a integração (visível), o lead espera sem retry em loop e retoma quando a credencial é corrigida', async () => {
      budgets({ TAVILY_MONTHLY_BUDGET: 50 })
      _setSearchProviderForTests({ search: async () => { const { ProviderAuthError } = await import('./api-guard.service'); throw new ProviderAuthError('Tavily: chave inválida (401)') } })
      _setQueueDepsForTests({ makeDeps: (id) => fakeDeps(id), tavilyConfigured: () => true, metaConfigured: () => false, classify: async () => ({ status: 'sem_site', siteUrl: null, linksEncontrados: {}, fonte: null, siteStatus: null, instagramHandle: null }) })
      const l = await mkLead()
      await processLead(await claimOne(l.id), new QuotaRun('t'))
      const r = await prisma.prospect.findUnique({ where: { id: l.id } })
      expect(r?.investigationState).toBe('WAITING_RETRY')
      expect(r?.investigationWaitReason).toContain('PROVIDER_PAUSED')
      expect(r?.investigationAttempts).toBe(0) // pausa não consome tentativas
      const st = await prisma.providerState.findUnique({ where: { provider: 'TAVILY' } })
      expect(st).toMatchObject({ status: 'PAUSED_AUTH' })
      const u = await getUsage()
      expect(u.usage.TAVILY.bloqueio?.code).toBe('PROVIDER_PAUSED')
      _resetProviderStateForTests(); await resumeProvider('TAVILY')
      expect((await getUsage()).usage.TAVILY.bloqueio).toBeNull()
    })

    it('manual: site e @ informados à mão nunca são sobrescritos pela investigação, e o site manual vale como confirmado', async () => {
      budgets({ TAVILY_MONTHLY_BUDGET: 50 }); useDeps()
      const l = await mkLead({ siteManual: true, foundWebsite: 'https://meusite.com.br', instagramManual: true, instagramHandle: 'meu.manual' })
      await processLead(await claimOne(l.id), new QuotaRun('t'))
      const r = await prisma.prospect.findUnique({ where: { id: l.id } })
      expect(r).toMatchObject({ foundWebsite: 'https://meusite.com.br', instagramHandle: 'meu.manual', websiteStatus: 'HAS_WEBSITE' })
    })

    it('status/responsável/notas do lead são preservados pela investigação', async () => {
      budgets({ TAVILY_MONTHLY_BUDGET: 50 }); useDeps()
      const l = await mkLead({ status: 'negociando', responsavel: 'Max', notes: 'ligar terça' })
      await processLead(await claimOne(l.id), new QuotaRun('t'))
      expect(await prisma.prospect.findUnique({ where: { id: l.id } })).toMatchObject({ status: 'negociando', responsavel: 'Max', notes: 'ligar terça' })
    })
  })

  // ── Revisão: lease com token, claim do cache, elegibilidade, campanha, Google ───────────────────────────────────
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
  const eligibleOf = async (id: string) => noWebsiteEligibility((await prisma.prospect.findUnique({ where: { id } }))!)
  const stubClassify = (async () => ({ status: 'sem_site', siteUrl: null, linksEncontrados: {}, fonte: null, siteStatus: null, instagramHandle: null })) as never
  const mkL = (over: Record<string, unknown> = {}) => prisma.prospect.create({ data: { arenaName: 'Arena Tribo', city: 'Tubarão', state: 'SC', placeId: `p-${Math.random()}`, whatsapp: '(48) 99123-4567', phoneE164: '+5548991234567', phoneCountry: 'BR', phoneMobile: true, verificadoEm: new Date(), investigationState: 'PENDING', investigationNextRunAt: new Date(Date.now() - 1000), ...over } })
  const row = (type: 'SEARCH_RESULTS' | 'IG_BIO' = 'SEARCH_RESULTS') => ({ source: 'TAVILY' as const, type, key: 'k', value: { kind: 'NAME', query: 'k', results: [] }, outcome: 'EMPTY', fromCache: false, collectedAt: new Date(), dependsOn: 'x', version: '' })

  describe('lease por claim: token único, renovação e worker antigo', () => {
    const mk2 = (over: Record<string, unknown> = {}) => prisma.prospect.create({ data: { arenaName: 'Arena X', city: 'Tubarão', state: 'SC', investigationState: 'PENDING', investigationNextRunAt: new Date(Date.now() - 1000), ...over } })

    it('cada claim recebe um token DIFERENTE (INSTANCE_ID sozinho não identifica a execução)', async () => {
      const l = await mk2()
      const [a] = await claimBatch(1, 'mesmo-worker')
      expect(a.token).toMatch(/^[0-9a-f-]{36}$/)
      await prisma.prospect.update({ where: { id: l.id }, data: { investigationLockedUntil: new Date(Date.now() - 1000) } })
      await recoverExpiredLeases(); await sleep(5) // nextRunAt é TIMESTAMP(3): arredonda p/ cima; espera 1 tick
      const [b] = await claimBatch(1, 'mesmo-worker')
      expect(b.id).toBe(a.id)
      expect(b.token).not.toBe(a.token)
    })

    it('lease vencida, novo claim e worker ANTIGO tentando renovar, gravar evidência e finalizar: nada do antigo vale', async () => {
      const l = await mk2()
      const [a] = await claimBatch(1)
      await prisma.prospect.update({ where: { id: l.id }, data: { investigationLockedUntil: new Date(Date.now() - 1000) } })
      expect(await renewLease(l.id, a.token)).toBe(false) // vencida = perdida, mesmo antes de alguém reclamar
      await recoverExpiredLeases(); await sleep(5)
      const [b] = await claimBatch(1)
      expect(await renewLease(l.id, a.token)).toBe(false) // o antigo não renova a lease do novo
      expect(await renewLease(l.id, b.token)).toBe(true)
      await expect(saveEvidenceOwned(l.id, a.token, row())).rejects.toBeInstanceOf(LeaseLostError)
      expect(await prisma.leadEvidence.count({ where: { prospectId: l.id } })).toBe(0)
      await saveEvidenceOwned(l.id, b.token, row()) // o dono vigente grava
      expect(await prisma.leadEvidence.count({ where: { prospectId: l.id } })).toBe(1)
    })

    it('worker antigo concluindo a execução (processLead) NÃO escreve nem libera o claim do novo; para sem chamadas externas', async () => {
      const l = await mkL()
      const [a] = await claimBatch(1)
      await prisma.prospect.update({ where: { id: l.id }, data: { investigationLockedUntil: new Date(Date.now() - 1000) } })
      await recoverExpiredLeases(); await sleep(5)
      const [b] = await claimBatch(1) // novo worker assumiu
      const calls = { google: 0, search: 0 }
      _setSearchProviderForTests({ search: async () => { calls.search++; return [] } })
      _setQueueDepsForTests({
        makeDeps: (id) => ({ ...fakeDepsFor(id), google: async (placeId) => { calls.google++; return { status: 'OK' as const, data: { placeId, websiteUri: null, nationalPhone: null, internationalPhone: null, rating: null, userRatingCount: null, collection: 'place-details-enterprise:v1' }, fromCache: false, collectedAt: new Date(), outcome: 'NEGATIVE' as const } }, search: async () => { calls.search++; return { status: 'OK' as const, data: [], fromCache: false, collectedAt: new Date(), outcome: 'NEGATIVE' as const } } }),
        tavilyConfigured: () => true, metaConfigured: () => false, googleConfigured: () => true, classify: stubClassify,
      })
      budgets({ TAVILY_MONTHLY_BUDGET: 50 })
      await processLead(a, new QuotaRun('antigo')) // execução do token A, já sem posse
      const r = await prisma.prospect.findUnique({ where: { id: l.id } })
      expect(r).toMatchObject({ investigationState: 'PROCESSING', investigationLockToken: b.token, websiteStatus: null }) // claim do novo intacto, nada decidido
      expect(await prisma.leadEvidence.count({ where: { prospectId: l.id } })).toBe(0) // nenhuma evidência do antigo
      expect(calls.search).toBe(0) // depois de perder o claim, nenhuma nova consulta paga
      expect(calls.google).toBeLessThanOrEqual(1) // no máximo a que já estava em voo ao perder a posse
    })

    it('heartbeat: renova enquanto é dono; perdeu o claim ou não conseguiu renovar até o fim da lease → isActive() = false', async () => {
      let n = 0
      const hb = startLeaseHeartbeat({ id: 'x', token: 't' }, 60, async () => { n++; return n < 3 })
      await new Promise((r) => setTimeout(r, 25)); expect(hb.isActive()).toBe(true)
      await new Promise((r) => setTimeout(r, 70)); expect(hb.isActive()).toBe(false) // 3ª renovação negada → perdido
      hb.stop()
      const flaky = startLeaseHeartbeat({ id: 'y', token: 't' }, 60, async () => { throw new Error('db caiu') })
      expect(flaky.isActive()).toBe(true)
      await new Promise((r) => setTimeout(r, 90)); expect(flaky.isActive()).toBe(false) // sem confirmar posse até vencer: conservador
      flaky.stop()
    })

    it('renovação REAL estende a lease do dono (banco)', async () => {
      const l = await mk2()
      const [a] = await claimBatch(1)
      await prisma.prospect.update({ where: { id: l.id }, data: { investigationLockedUntil: new Date(Date.now() + 5000) } })
      expect(await renewLease(l.id, a.token)).toBe(true)
      const r = await prisma.prospect.findUnique({ where: { id: l.id } })
      expect(r!.investigationLockedUntil!.getTime()).toBeGreaterThan(Date.now() + 60_000)
    })
  })

  describe('ApiCache: claim vencido adquirido por outro', () => {
    it('o dono anterior não libera nem sobrescreve o claim (e a resposta) do novo dono', async () => {
      const key = 'TAVILY|SEARCH_BASIC|v1|q=teste'
      const old = (await prismaCacheStore.claim(key, 'TAVILY', 'SEARCH_BASIC', 1000)) as string
      expect(old).toBeTruthy()
      expect(await prismaCacheStore.claim(key, 'TAVILY', 'SEARCH_BASIC', 1000)).toBeNull() // ainda vigente
      await new Promise((r) => setTimeout(r, 1200)) // claim venceu
      const novo = (await prismaCacheStore.claim(key, 'TAVILY', 'SEARCH_BASIC', 60_000)) as string
      expect(novo).toBeTruthy(); expect(novo).not.toBe(old)
      await prismaCacheStore.release(key, old) // o antigo tenta liberar
      expect(await prismaCacheStore.claim(key, 'TAVILY', 'SEARCH_BASIC', 60_000)).toBeNull() // claim do novo continua
      expect(await prismaCacheStore.put(key, 'TAVILY', 'SEARCH_BASIC', ['velho'], 'POSITIVE', 3600_000, old)).toBe(false)
      expect(await prismaCacheStore.get(key)).toBeNull()
      expect(await prismaCacheStore.put(key, 'TAVILY', 'SEARCH_BASIC', ['novo'], 'POSITIVE', 3600_000, novo)).toBe(true)
      expect((await prismaCacheStore.get(key))?.response).toEqual(['novo'])
    })
  })

  describe('elegibilidade para "só sem site" com banco real', () => {
    function deps(over: Partial<InvestigationDeps> = {}) {
      _setSearchProviderForTests({ search: async () => [] })
      _setQueueDepsForTests({ makeDeps: (id) => ({ ...fakeDepsFor(id), ...over }), tavilyConfigured: () => true, metaConfigured: () => false, googleConfigured: () => true, classify: stubClassify })
    }
    const claimOne2 = async (id: string) => { const c = (await claimBatch(50, INSTANCE_ID)).find((x) => x.id === id); expect(c).toBeDefined(); return c! }
    const eligible = async (id: string) => noWebsiteEligibility((await prisma.prospect.findUnique({ where: { id } }))!)
    const decide = async () => { budgets({ TAVILY_MONTHLY_BUDGET: 50 }); deps(); const l = await mkL(); await processLead(await claimOne2(l.id), new QuotaRun('t')); return l }

    it('investigação completa e vigente → elegível (e persistida com outcome FINAL + validade)', async () => {
      const l = await decide()
      const r = await prisma.prospect.findUnique({ where: { id: l.id } })
      expect(r).toMatchObject({ websiteStatus: 'PROBABLY_NO_WEBSITE', websiteOutcome: 'FINAL', investigationState: 'DONE', classifierVersion: CLASSIFIER_VERSION })
      expect(r!.websiteValidUntil!.getTime()).toBeGreaterThan(Date.now())
      expect(await eligible(l.id)).toMatchObject({ eligible: true })
    })

    it('negativo antigo + evidência vencida + cota esgotada: decisão antiga fica como HISTÓRICO, mas NÃO é elegível (nem no seletor da campanha)', async () => {
      const l = await decide()
      const old = new Date(Date.now() - 31 * 86_400_000)
      await prisma.leadEvidence.updateMany({ where: { prospectId: l.id }, data: { collectedAt: old } }) // tudo venceu
      await prisma.apiCache.deleteMany() // e o cache de consultas também (senão a consulta seria atendida legitimamente por ele)
      await prisma.prospect.update({ where: { id: l.id }, data: { websiteValidUntil: new Date(Date.now() - 1000), investigationState: 'PENDING', investigationNextRunAt: new Date(Date.now() - 1000) } })
      budgets({ TAVILY_MONTHLY_BUDGET: 1 }); await reserve('TAVILY', T) // cota do mês esgotada
      await processLead(await claimOne2(l.id), new QuotaRun('t2'))
      const r = await prisma.prospect.findUnique({ where: { id: l.id } })
      expect(r).toMatchObject({ websiteStatus: 'PROBABLY_NO_WEBSITE', websiteOutcome: 'INCOMPLETE', investigationState: 'WAITING_QUOTA' }) // histórico preservado, investigação atual incompleta
      const v = await eligible(l.id)
      expect(v.eligible).toBe(false)
      expect(v.reasons).toEqual(expect.arrayContaining(['DECISION_NOT_FINAL', 'INVESTIGATION_NOT_DONE']))
      await expect(createCampaign({ name: 'c', messages: ['oi'], targetStatus: 'nao_contatado', publico: 'sem_site', limite: 0, delaySec: 1 } as never)).rejects.toThrow(/Nenhum lead/)
    })

    it('candidato NOVO pendente contra negativo antigo: perde a elegibilidade até ser avaliado', async () => {
      const l = await decide()
      expect((await eligible(l.id)).eligible).toBe(true)
      await prisma.prospect.update({ where: { id: l.id }, data: { foundWebsite: 'https://novo-site-arena.com.br', foundWebsiteSource: 'busca', investigationState: 'PENDING', investigationNextRunAt: new Date(Date.now() - 1000) } })
      deps({ fetchFacts: async (u) => extractPageFacts({ url: u, finalUrl: u, html: '', httpStatus: 403, blocked: true }) }) // 403/anti-bot: não avaliável
      await processLead(await claimOne2(l.id), new QuotaRun('t2'))
      const r = await prisma.prospect.findUnique({ where: { id: l.id } })
      expect(r).toMatchObject({ websiteOutcome: 'NEEDS_REVIEW' }) // atual: candidato não avaliável (403) — a conclusão negativa anterior não vale mais
      const v = await eligible(l.id)
      expect(v.eligible).toBe(false)
      expect(v.reasons).toEqual(expect.arrayContaining(['CANDIDATE_PENDING', 'STATUS_NOT_NEGATIVE']))
    })

    it('--keep-legacy: lead SEM evidência mantém a decisão antiga como histórico, mas NÃO é elegível para "só sem site"', async () => {
      const l = await mkL({ websiteStatus: 'PROBABLY_NO_WEBSITE', websiteConfidence: 0.9, classifierVersion: CLASSIFIER_VERSION, investigationState: 'DONE', investigationNextRunAt: null })
      expect((await eligible(l.id)).eligible).toBe(false) // legado: sem outcome/validade/cobertura
      execFileSync('npx', ['tsx', 'prisma/reclassify-websites.ts', '--apply', '--confirm-backup', '--keep-legacy'], { env: { ...process.env, DATABASE_URL: URL as string, JWT_SECRET: 'x'.repeat(40), JWT_REFRESH_SECRET: 'y'.repeat(40), TAVILY_API_KEY: '' }, stdio: 'pipe' })
      const r = await prisma.prospect.findUnique({ where: { id: l.id } })
      expect(r).toMatchObject({ websiteStatus: 'PROBABLY_NO_WEBSITE', websiteConfidence: 0.9, websiteOutcome: 'LEGACY', websiteValidUntil: null }) // histórico intacto, marcado LEGACY
      const v = await eligible(l.id)
      expect(v.eligible).toBe(false)
      expect(v.reasons).toContain('DECISION_NOT_FINAL')
      await expect(createCampaign({ name: 'c', messages: ['oi'], targetStatus: 'nao_contatado', publico: 'sem_site', limite: 0, delaySec: 1 } as never)).rejects.toThrow(/Nenhum lead/)
    }, 60_000)

    it('sem --keep-legacy: lead sem evidência é recalculado e NÃO herda "sem site"', async () => {
      const l = await mkL({ websiteStatus: 'PROBABLY_NO_WEBSITE', websiteConfidence: 0.9, classifierVersion: CLASSIFIER_VERSION, investigationState: 'DONE', investigationNextRunAt: null })
      execFileSync('npx', ['tsx', 'prisma/reclassify-websites.ts', '--apply', '--confirm-backup'], { env: { ...process.env, DATABASE_URL: URL as string, JWT_SECRET: 'x'.repeat(40), JWT_REFRESH_SECRET: 'y'.repeat(40), TAVILY_API_KEY: '' }, stdio: 'pipe' })
      const r = await prisma.prospect.findUnique({ where: { id: l.id } })
      expect(r).toMatchObject({ websiteStatus: 'UNKNOWN', websiteOutcome: 'INCOMPLETE' })
      expect((await eligible(l.id)).eligible).toBe(false)
    }, 60_000)
  })

  describe('campanha "só sem site": elegibilidade reavaliada no ENVIO', () => {
    const base = { arenaName: 'Arena', status: 'nao_contatado', websiteStatus: 'PROBABLY_NO_WEBSITE', websiteConfidence: 0.8, websiteOutcome: 'FINAL', classifierVersion: CLASSIFIER_VERSION, investigationState: 'DONE', phoneE164: '+5548991234567' }
    const coverage = { required: ['GOOGLE'], done: ['GOOGLE'], failed: [], staleNegative: false, candidates: [] }
    const eligibleLead = (n: number, over: Record<string, unknown> = {}) => prisma.prospect.create({ data: { ...base, whatsapp: `(48) 99999-000${n}`, websiteValidUntil: new Date(Date.now() + 3600_000), websiteCoverage: coverage, ...over } })

    it('o seletor leva só quem está elegível; quem perdeu a elegibilidade depois da inclusão é IGNORADO com motivo, sem apagar o destinatário', async () => {
      const a = await eligibleLead(1); const b = await eligibleLead(2)
      await eligibleLead(3, { websiteOutcome: 'LEGACY' }) // nunca entra
      const c = await createCampaign({ name: 'só sem site', messages: ['oi'], targetStatus: 'nao_contatado', publico: 'sem_site', limite: 0, delaySec: 1 } as never)
      const recs = await prisma.campaignRecipient.findMany({ where: { campaignId: c.id } })
      expect(recs.map((r) => r.prospectId).sort()).toEqual([a.id, b.id].sort())
      expect(await prisma.campaign.findUnique({ where: { id: c.id } })).toMatchObject({ publico: 'sem_site' })
      // depois da inclusão, B perde a validade (evidência vencida) e a campanha começa a enviar
      await prisma.prospect.update({ where: { id: b.id }, data: { websiteValidUntil: new Date(Date.now() - 1000) } })
      await prisma.campaign.update({ where: { id: c.id }, data: { status: 'RUNNING', delayMinSec: 0, delayMaxSec: 0 } })
      mocks.sendMessage.mockReset(); mocks.sendMessage.mockResolvedValue({ ok: true })
      await _dispatchLoopForTests(c.id)
      expect(mocks.sendMessage).toHaveBeenCalledTimes(1) // só o A foi enviado
      const after = await prisma.campaignRecipient.findMany({ where: { campaignId: c.id } })
      const ra = after.find((r) => r.prospectId === a.id)!; const rb = after.find((r) => r.prospectId === b.id)!
      expect(ra.status).toBe('SENT')
      expect(rb).toMatchObject({ status: 'SKIPPED', sentAt: null })
      expect(rb.skipReason).toContain('EVIDENCE_EXPIRED')
      expect(after).toHaveLength(2) // histórico preservado
      expect(await prisma.campaign.findUnique({ where: { id: c.id } })).toMatchObject({ status: 'DONE' })
      expect((await prisma.prospect.findUnique({ where: { id: b.id } }))?.status).toBe('nao_contatado') // lead ignorado não avança na cadência
    })

    it('candidato novo/reinvestigação em andamento no momento do envio também bloqueia; campanha "todos" não é afetada', async () => {
      const a = await eligibleLead(4)
      const c = await createCampaign({ name: 'x', messages: ['oi'], targetStatus: 'nao_contatado', publico: 'sem_site', limite: 0, delaySec: 1 } as never)
      await prisma.prospect.update({ where: { id: a.id }, data: { investigationState: 'PENDING' } }) // reinvestigação entrou na fila
      await prisma.campaign.update({ where: { id: c.id }, data: { status: 'RUNNING', delayMinSec: 0, delayMaxSec: 0 } })
      mocks.sendMessage.mockReset(); mocks.sendMessage.mockResolvedValue({ ok: true })
      await _dispatchLoopForTests(c.id)
      expect(mocks.sendMessage).not.toHaveBeenCalled()
      expect((await prisma.campaignRecipient.findFirst({ where: { campaignId: c.id } }))?.skipReason).toContain('INVESTIGATION_NOT_DONE')
      const todos = await createCampaign({ name: 'todos', messages: ['oi'], targetStatus: 'nao_contatado', publico: 'todos', limite: 0, delaySec: 1 } as never)
      await prisma.campaign.update({ where: { id: todos.id }, data: { status: 'RUNNING', delayMinSec: 0, delayMaxSec: 0 } })
      await _dispatchLoopForTests(todos.id)
      expect(mocks.sendMessage).toHaveBeenCalled() // público "todos" não reavalia elegibilidade
    })
  })

  describe('Google: evidência com proveniência', () => {
    it('placeId SEM evidência → UMA chamada de Place Details grava a coleta; a investigação seguinte reaproveita (sem nova chamada)', async () => {
      budgets({ TAVILY_MONTHLY_BUDGET: 50 })
      let googleCalls = 0
      _setSearchProviderForTests({ search: async () => [] })
      _setQueueDepsForTests({ makeDeps: (id) => ({ ...fakeDepsFor(id), google: async (placeId) => { googleCalls++; return { status: 'OK' as const, data: { placeId, websiteUri: null, nationalPhone: null, internationalPhone: null, rating: null, userRatingCount: null, collection: 'place-details-enterprise:v1' }, fromCache: false, collectedAt: new Date(), outcome: 'NEGATIVE' as const } } }), tavilyConfigured: () => true, metaConfigured: () => false, googleConfigured: () => true, classify: stubClassify })
      const l = await mkL()
      const c1 = (await claimBatch(50)).find((x) => x.id === l.id)!
      await processLead(c1, new QuotaRun('a'))
      expect(googleCalls).toBe(1)
      expect(await prisma.leadEvidence.findFirst({ where: { prospectId: l.id, source: 'GOOGLE', type: 'PLACE_FIELDS' } })).toMatchObject({ key: l.placeId, outcome: 'NO_WEBSITE_FIELD', fromCache: false })
      await enqueueSiteClassify(l.id)
      const c2 = (await claimBatch(50)).find((x) => x.id === l.id)!
      await processLead(c2, new QuotaRun('b'))
      expect(googleCalls).toBe(1) // evidência vigente: nada adicional
    })

    const nichoNovo = () => prisma.nicho.create({ data: { nome: `Arena teste ${Math.random().toString(36).slice(2, 8)}`, termosBusca: [] } })
    const proPlace = (id: string, over: Record<string, unknown> = {}) => ({ placeId: id, nome: `Arena ${id}`, endereco: `Rua ${id}, 10 - Centro, Tubarão - SC`, addressComponents: null, telefone: null, telefoneInternacional: null, website: null, avaliacao: null, numAvaliacoes: null, primaryType: 'sports_club', collectedAt: new Date(), fromCache: false, ...over })

    it('DESCOBERTA (Pro): cria o lead SEM telefone/site/nota, aguardando o Details; nada é classificado, enfileirado nem decidido ("sem site" nunca nasce aqui)', async () => {
      const nicho = await nichoNovo()
      mocks.searchPlaces.mockResolvedValueOnce([proPlace('g-1'), proPlace('g-2')])
      await buscarLeads(nicho.id, 'Tubarão - SC')
      const leads = await prisma.prospect.findMany({ where: { nichoId: nicho.id } })
      expect(leads).toHaveLength(2)
      for (const l of leads) {
        expect(l).toMatchObject({ whatsapp: null, phoneE164: null, website: null, avaliacao: null, numAvaliacoes: null, websiteStatus: null, websiteOutcome: null, primaryType: 'sports_club', investigationState: 'PENDING', investigationNextRunAt: null, investigationNextAction: 'GOOGLE_DETAILS', investigationWaitReason: 'AWAITING_DETAILS_SELECTION' })
        expect(await prisma.leadEvidence.count({ where: { prospectId: l.id } })).toBe(0) // a busca Pro NÃO gera evidência do campo websiteUri
      }
      expect(await claimBatch(10)).toHaveLength(0) // aguardando seleção: o worker não pega
      expect((await eligibleOf(leads[0].id)).eligible).toBe(false)
    })

    it('lead SEM Details nunca é classificado como "sem site": Details bloqueado por cota → UNKNOWN, statusSite intocado, nenhum Tavily gasto', async () => {
      budgets({ TAVILY_MONTHLY_BUDGET: 50 })
      let tavily = 0; let classified = 0
      _setSearchProviderForTests({ search: async () => { tavily++; return [] } })
      _setQueueDepsForTests({ makeDeps: (id) => ({ ...fakeDepsFor(id), google: async () => ({ status: 'BLOCKED' as const, block: { code: 'WINDOW_M' as const, detail: 'GOOGLE_PLACE_DETAILS_ENTERPRISE sem orçamento', retryAt: new Date(Date.now() + 3600_000) } }) }), tavilyConfigured: () => true, metaConfigured: () => false, googleConfigured: () => true, classify: (async () => { classified++; return { status: 'sem_nada', siteUrl: null, linksEncontrados: {}, fonte: null, siteStatus: null, instagramHandle: null } }) as never })
      const l = await mkL({ whatsapp: null, phoneE164: null, verificadoEm: null })
      const antes = (await prisma.prospect.findUniqueOrThrow({ where: { id: l.id } })).statusSite
      await processLead((await claimBatch(50)).find((x) => x.id === l.id)!, new QuotaRun('t'))
      const r = await prisma.prospect.findUnique({ where: { id: l.id } })
      expect(r).toMatchObject({ websiteStatus: 'UNKNOWN', statusSite: antes, investigationState: 'WAITING_QUOTA', investigationNextAction: 'GOOGLE_DETAILS' })
      expect(r?.websiteStatus).not.toBe('PROBABLY_NO_WEBSITE')
      expect(classified).toBe(0) // a classificação legada ("sem_nada") só roda depois do Details
      expect(tavily).toBe(0)
      expect((await eligibleOf(l.id)).eligible).toBe(false)
    })

    it('Details aplicado: telefone/site/nota/avaliações entram no lead, a classificação legada roda e a investigação segue com o telefone novo', async () => {
      budgets({ TAVILY_MONTHLY_BUDGET: 50 })
      const queries: string[] = []; let classified = 0
      _setSearchProviderForTests({ search: async (q) => { queries.push(q); return [] } })
      _setQueueDepsForTests({
        makeDeps: (id) => ({ ...fakeDepsFor(id), google: async (placeId) => ({ status: 'OK' as const, data: { placeId, websiteUri: null, nationalPhone: '(48) 99123-4567', internationalPhone: '+55 48 99123-4567', rating: 4.6, userRatingCount: 120, collection: 'place-details-enterprise:v1' }, fromCache: false, collectedAt: new Date(), outcome: 'POSITIVE' as const }) }),
        tavilyConfigured: () => true, metaConfigured: () => false, googleConfigured: () => true,
        classify: (async () => { classified++; return { status: 'sem_nada', siteUrl: null, linksEncontrados: {}, fonte: null, siteStatus: null, instagramHandle: null } }) as never,
      })
      const l = await mkL({ whatsapp: null, phoneE164: null, phoneMobile: null, verificadoEm: null })
      await processLead((await claimBatch(50)).find((x) => x.id === l.id)!, new QuotaRun('t'))
      const r = await prisma.prospect.findUnique({ where: { id: l.id } })
      expect(r).toMatchObject({ phoneE164: '+5548991234567', phoneMobile: true, avaliacao: 4.6, numAvaliacoes: 120, websiteStatus: 'PROBABLY_NO_WEBSITE', investigationState: 'DONE' })
      expect(classified).toBeGreaterThanOrEqual(1)
      expect(queries.some((q) => q.includes('(48) 99123-4567'))).toBe(true) // a consulta por TELEFONE só existe porque o Details trouxe o número
      expect(await prisma.leadEvidence.count({ where: { prospectId: l.id, source: 'GOOGLE', type: 'PLACE_FIELDS' } })).toBe(1)
    })

    it('Enriquecer: só os PRIORIZADOS dentro do saldo do Details são enfileirados; o resto continua aguardando; lead já com Details não paga de novo', async () => {
      const nicho = await nichoNovo()
      budgets({ TAVILY_MONTHLY_BUDGET: 50, GOOGLE_PLACE_DETAILS_ENTERPRISE_MONTHLY_BUDGET: 100 }); Object.assign(env, { API_QUOTA_SAFETY_PERCENT: 0, GOOGLE_DETAILS_ENRICH_MAX_PER_REQUEST: 25 })
      mocks.searchPlaces.mockResolvedValueOnce(Array.from({ length: 40 }, (_, i) => proPlace(`e-${i}`, { primaryType: i < 10 ? 'tennis_court' : 'bakery' })))
      await buscarLeads(nicho.id, 'Tubarão - SC')
      const comDetails = await prisma.prospect.findFirstOrThrow({ where: { nichoId: nicho.id, placeId: 'e-3' } })
      await prisma.leadEvidence.create({ data: { prospectId: comDetails.id, source: 'GOOGLE', type: 'PLACE_FIELDS', key: 'e-3', value: { websiteUri: null }, outcome: 'NO_WEBSITE_FIELD', collectedAt: new Date(), version: 'place-details-enterprise:v1' } })
      for (let i = 0; i < 90; i++) await reserve('GOOGLE_PLACE_DETAILS_ENTERPRISE', { operation: 'PLACE_DETAILS_ENTERPRISE' }) // saldo = 10
      const r = await enriquecerNicho(nicho.id)
      expect(r.details).toMatchObject({ selecionados: 10, saldoDetails: 10, limiteAplicado: 10 })
      const enq = await prisma.prospect.findMany({ where: { nichoId: nicho.id, investigationNextRunAt: { not: null } }, select: { placeId: true, primaryType: true } })
      expect(enq).toHaveLength(10)
      expect(enq.filter((x) => x.primaryType === 'tennis_court')).toHaveLength(9) // os 9 de tipo compatível SEM Details vêm primeiro (o 10º tênis já tinha)
      expect(enq.some((x) => x.placeId === 'e-3')).toBe(false) // já tinha Details vigente
      expect(await prisma.prospect.count({ where: { nichoId: nicho.id, investigationNextRunAt: null, investigationWaitReason: 'AWAITING_DETAILS_SELECTION' } })).toBe(30)
    })

    it('lead SEM telefone nunca entra em campanha de WhatsApp (público "todos" nem "sem site")', async () => {
      const semTel = await prisma.prospect.create({ data: { arenaName: 'Sem telefone', status: 'nao_contatado', placeId: 'x-1', investigationState: 'PENDING' } })
      await prisma.prospect.create({ data: { arenaName: 'Vazio', status: 'nao_contatado', whatsapp: '' } })
      const comTel = await prisma.prospect.create({ data: { arenaName: 'Com telefone', status: 'nao_contatado', whatsapp: '(48) 99111-2222', phoneE164: '+5548991112222' } })
      const c = await createCampaign({ name: 'todos', messages: ['oi'], targetStatus: 'nao_contatado', publico: 'todos', limite: 0, delaySec: 1 } as never)
      const recs = await prisma.campaignRecipient.findMany({ where: { campaignId: c.id } })
      expect(recs.map((x) => x.prospectId)).toEqual([comTel.id])
      expect(recs.some((x) => x.prospectId === semTel.id)).toBe(false)
    })
  })

  describe('campanhas anteriores ao controle de público: migração seguida de tentativa de envio', () => {
    // No sistema de origem isto lia a migration que criou a coluna `publico`; aqui o schema já nasce com ela, então o teste
    // reproduz só o efeito da migration: campanhas antigas viram 'legacy_unverified' e as RUNNING são pausadas.
    const MIGRATION = `UPDATE "Campaign" SET "publico" = 'legacy_unverified'; UPDATE "Campaign" SET "status" = 'PAUSED' WHERE "status" = 'RUNNING';`
    const stmts = MIGRATION.replace(/^\s*--.*$/gm, '').split(';').map((x) => x.trim()).filter(Boolean)

    async function legacyCampaign() {
      // estado de ANTES da migration: a coluna publico não existe e a campanha está RODANDO (intenção original desconhecida)
      await prisma.$executeRawUnsafe('ALTER TABLE "Campaign" DROP COLUMN IF EXISTS "publico"')
      const lead = await prisma.prospect.create({ data: { arenaName: 'Arena Velha', whatsapp: '(48) 99999-1111', phoneE164: '+5548999991111', status: 'nao_contatado', websiteStatus: 'PROBABLY_NO_WEBSITE', websiteConfidence: 0.9 } })
      await prisma.$executeRawUnsafe(`INSERT INTO "Campaign"("id","name","messages","targetStatus","status","delayMinSec","delayMaxSec","createdAt","updatedAt") VALUES ('c_legacy','Antiga','["oi"]','nao_contatado','RUNNING',0,0,now(),now())`)
      await prisma.$executeRawUnsafe(`INSERT INTO "CampaignRecipient"("id","campaignId","prospectId","name","phone","status","createdAt") VALUES ('r_legacy','c_legacy','${lead.id}','Arena Velha','+5548999991111','PENDING',now())`)
      for (const st of stmts) await prisma.$executeRawUnsafe(st) // a migration REAL, statement a statement
      return lead
    }

    it('a migration não vira "todos": a campanha RUNNING fica PAUSADA e legacy_unverified; tentar enviar NÃO envia nada', async () => {
      await legacyCampaign()
      const c = await prisma.campaign.findUnique({ where: { id: 'c_legacy' } })
      expect(c).toMatchObject({ publico: 'legacy_unverified', status: 'PAUSED' })
      mocks.sendMessage.mockReset(); mocks.sendMessage.mockResolvedValue({ ok: true })
      await _dispatchLoopForTests('c_legacy') // loop não roda: campanha não está RUNNING
      expect(mocks.sendMessage).not.toHaveBeenCalled()
      await expect(startCampaign('c_legacy')).rejects.toThrow(/revise o público/)
      // mesmo se alguém a marcar RUNNING à força (ou o retomar do boot a pegar), o loop se recusa a enviar e a pausa de novo
      await prisma.campaign.update({ where: { id: 'c_legacy' }, data: { status: 'RUNNING' } })
      await _dispatchLoopForTests('c_legacy')
      expect(mocks.sendMessage).not.toHaveBeenCalled()
      expect(await prisma.campaign.findUnique({ where: { id: 'c_legacy' } })).toMatchObject({ status: 'PAUSED', publico: 'legacy_unverified' })
      expect((await prisma.campaignRecipient.findUnique({ where: { id: 'r_legacy' } }))?.status).toBe('PENDING') // nada foi apagado nem enviado
    })

    it('revisão explícita: "sem_site" volta a reavaliar a elegibilidade de cada lead no envio; "todos" libera; revisar duas vezes é recusado', async () => {
      const lead = await legacyCampaign()
      const r = await reviewCampaignAudience('c_legacy', 'sem_site')
      expect(r).toMatchObject({ publico: 'sem_site', status: 'PAUSED' }) // revisar não inicia
      await prisma.campaign.update({ where: { id: 'c_legacy' }, data: { status: 'RUNNING' } })
      mocks.sendMessage.mockReset(); mocks.sendMessage.mockResolvedValue({ ok: true })
      await _dispatchLoopForTests('c_legacy')
      expect(mocks.sendMessage).not.toHaveBeenCalled() // lead com decisão antiga (sem outcome/validade) NÃO é elegível
      expect(await prisma.campaignRecipient.findUnique({ where: { id: 'r_legacy' } })).toMatchObject({ status: 'SKIPPED' })
      await expect(reviewCampaignAudience('c_legacy', 'todos')).rejects.toThrow(/já foi definido/)
      // outra campanha antiga revisada como "todos" volta a enviar
      await prisma.$executeRawUnsafe(`INSERT INTO "Campaign"("id","name","messages","targetStatus","status","delayMinSec","delayMaxSec","createdAt","updatedAt") VALUES ('c_legacy2','Antiga2','["oi"]','nao_contatado','PAUSED',0,0,now(),now())`)
      await prisma.$executeRawUnsafe(`INSERT INTO "CampaignRecipient"("id","campaignId","prospectId","name","phone","status","createdAt") VALUES ('r_legacy2','c_legacy2','${lead.id}','Arena Velha','+5548999991111','PENDING',now())`)
      await prisma.$executeRawUnsafe(`UPDATE "Campaign" SET "publico"='legacy_unverified' WHERE id='c_legacy2'`)
      await reviewCampaignAudience('c_legacy2', 'todos')
      await prisma.campaign.update({ where: { id: 'c_legacy2' }, data: { status: 'RUNNING' } })
      await _dispatchLoopForTests('c_legacy2')
      expect(mocks.sendMessage).toHaveBeenCalledTimes(1)
    })

    it('reaplicar a migration não repausa campanha já revisada', async () => {
      await legacyCampaign()
      await reviewCampaignAudience('c_legacy', 'todos')
      await prisma.campaign.update({ where: { id: 'c_legacy' }, data: { status: 'RUNNING' } })
      for (const st of stmts) await prisma.$executeRawUnsafe(st)
      expect((await prisma.campaign.findUnique({ where: { id: 'c_legacy' } }))?.status).toBe('RUNNING')
    })
  })

  describe('cotas: mudança de ciclo com consumo já gravado (Postgres real)', () => {
    it('bloqueia com CONFIG_CHANGED sem apagar o consumo; só a reconciliação explícita reabre, respeitando o consumo declarado', async () => {
      budgets({ TAVILY_MONTHLY_BUDGET: 4 })
      const E = env as Record<string, unknown>
      for (let i = 0; i < 4; i++) expect((await reserve('TAVILY', T)).ok).toBe(true)
      expect((await reserve('TAVILY', T)).ok).toBe(false)
      const antes = await prisma.apiUsage.findMany({ orderBy: { key: 'asc' } })
      E.TAVILY_QUOTA_RESET = 'FIXED'; E.TAVILY_QUOTA_TZ = 'America/Sao_Paulo'
      try {
        const r = await reserve('TAVILY', T)
        expect(r.ok).toBe(false); if (!r.ok) expect(r.code).toBe('CONFIG_CHANGED')
        expect((await prisma.apiUsage.findMany({ orderBy: { key: 'asc' } })).map((x) => [x.key, x.count])).toEqual(antes.map((x) => [x.key, x.count])) // histórico intacto
        await reconcileQuotaConfig('TAVILY', { M: 3 }, 'conferido no console em 2026-10-10')
        const rs = await Promise.all(Array.from({ length: 5 }, () => reserve('TAVILY', T)))
        expect(rs.filter((x) => x.ok)).toHaveLength(0) // declarou 3, mas o contador já tinha 4: nunca diminui (a chave do mês coincide)
        const cfg = await prisma.apiQuotaConfig.findUnique({ where: { provider: 'TAVILY' } })
        expect(cfg?.fingerprint).toBe('FIXED|America/Sao_Paulo')
        expect((cfg?.history as { fingerprint: string }[])[0].fingerprint).toBe('FIXED|UTC')
      } finally { E.TAVILY_QUOTA_RESET = 'FIXED'; E.TAVILY_QUOTA_TZ = 'UTC' }
    })
  })

  describe('procedimento de atualização do banco existente (ensaio completo em bancos descartáveis)', () => {
    it('prisma/rehearse-migration.sh: aplica sem perda, é idempotente, faz rollback total na falha e recupera do backup', () => {
      const admin = new NodeURL(URL as string); admin.pathname = '/postgres'
      const out = execFileSync('prisma/rehearse-migration.sh', [], { env: { ...process.env, ADMIN_DATABASE_URL: admin.toString(), JWT_SECRET: 'x'.repeat(40), JWT_REFRESH_SECRET: 'y'.repeat(40) }, encoding: 'utf8', stdio: 'pipe' })
      expect(out).toContain('ENSAIO OK')
      expect(out).not.toContain('✗')
    }, 180_000)
  })
})
