import { describe, it, expect, vi, beforeEach } from 'vitest'

const pauseCalls = vi.hoisted(() => [] as string[])
vi.mock('./provider-state.service', () => ({ getProviderPause: async () => null, listProviderStates: async () => [], pauseProvider: async (p: string) => { pauseCalls.push(p) }, resumeProvider: async () => {} }))
vi.mock('../config/database', () => ({ prisma: {} }))

import { env } from '../config/env'
import { MemoryQuotaStore, setQuotaStore, getUsage, _resetQuotaForTests } from './api-quota.service'
import { guardedCall, MemoryCacheStore, setCacheStore, ProviderAuthError, ProviderRateLimitError, ProviderPlanLimitError, cacheKeyOf, type CacheStore } from './api-guard.service'

const base = (call: () => Promise<string[]>, over: Partial<Parameters<typeof guardedCall<string[]>>[0]> = {}) => ({
  provider: 'TAVILY' as const, operation: 'SEARCH_BASIC', cacheKey: cacheKeyOf('TAVILY', 'SEARCH_BASIC', 'v1', { q: 'Arena Tribo Tubarão SC' }),
  classify: (d: string[]) => (d.length ? { outcome: 'POSITIVE' as const, ttlMs: 3600_000 } : { outcome: 'NEGATIVE' as const, ttlMs: 1800_000 }), call, ...over,
})
const used = async () => (await getUsage()).usage.TAVILY.janelas.M.usado

describe('api-guard: cache → dedupe → reserva → chamada', () => {
  let cache: MemoryCacheStore
  beforeEach(() => {
    _resetQuotaForTests(); setQuotaStore(new MemoryQuotaStore()); cache = new MemoryCacheStore(); setCacheStore(cache); pauseCalls.length = 0
    Object.assign(env, { TAVILY_MONTHLY_BUDGET: 5, API_QUOTA_SAFETY_PERCENT: 0, TAVILY_EXTERNAL_RESERVED: 0, API_OPERATION_BUDGETS: undefined, API_QUOTA_ALLOW_ABOVE_DOCUMENTED_CAP: 'false' })
  })

  it('cache hit: devolve sem reservar orçamento e sem chamar o provedor, marcado fromCache', async () => {
    const call = vi.fn(async () => ['https://a.com'])
    const first = await guardedCall(base(call))
    expect(first.status === 'OK' && first.fromCache).toBe(false)
    const second = await guardedCall(base(call))
    expect(second.status).toBe('OK')
    if (second.status === 'OK') { expect(second.fromCache).toBe(true); expect(second.collectedAt).toEqual((first as { collectedAt: Date }).collectedAt) } // instante REAL da coleta, não "agora"
    expect(call).toHaveBeenCalledTimes(1)
    expect(await used()).toBe(1)
  })

  it('cache NEGATIVO (sem resultados) também evita nova chamada', async () => {
    const call = vi.fn(async () => [] as string[])
    await guardedCall(base(call)); await guardedCall(base(call))
    expect(call).toHaveBeenCalledTimes(1)
  })

  it('TTL diferente por resultado: negativo expirado repete a chamada, positivo ainda vale', async () => {
    const call = vi.fn(async () => [] as string[])
    await guardedCall(base(call))
    cache.rows.get(base(call).cacheKey)!.expiresAt = new Date(Date.now() - 1) // venceu
    await guardedCall(base(call))
    expect(call).toHaveBeenCalledTimes(2)
  })

  it('refresh pula o cache lido, mas CONTINUA reservando orçamento', async () => {
    const call = vi.fn(async () => ['x'])
    await guardedCall(base(call))
    await guardedCall(base(call, { refresh: true }))
    expect(call).toHaveBeenCalledTimes(2)
    expect(await used()).toBe(2)
  })

  it('refresh sem orçamento NÃO chama o provedor (force nunca ignora orçamento)', async () => {
    Object.assign(env, { TAVILY_MONTHLY_BUDGET: 1 })
    const call = vi.fn(async () => ['x'])
    await guardedCall(base(call))
    const r = await guardedCall(base(call, { refresh: true }))
    expect(r.status).toBe('BLOCKED')
    expect(call).toHaveBeenCalledTimes(1)
  })

  it('consultas iguais ao mesmo tempo viram UMA chamada e UMA reserva', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => { release = r })
    const call = vi.fn(async () => { await gate; return ['y'] })
    const ps = Array.from({ length: 10 }, () => guardedCall(base(call)))
    release()
    const rs = await Promise.all(ps)
    expect(rs.every((r) => r.status === 'OK')).toBe(true)
    expect(call).toHaveBeenCalledTimes(1)
    expect(await used()).toBe(1)
  })

  it('outra instância já está chamando a mesma consulta (claim no banco): IN_FLIGHT, sem reservar', async () => {
    await cache.claim(base(async () => []).cacheKey, 'TAVILY', 'SEARCH_BASIC', 60_000)
    const call = vi.fn(async () => ['z'])
    const r = await guardedCall(base(call))
    expect(r.status).toBe('IN_FLIGHT')
    expect(call).not.toHaveBeenCalled()
    expect(await used()).toBe(0)
  })

  it('cada TENTATIVA reserva, inclusive retry; erro depois da reserva NÃO devolve o orçamento', async () => {
    const call = vi.fn(async () => { throw new Error('timeout') })
    const a = await guardedCall(base(call))
    const b = await guardedCall(base(call)) // "retry" do chamador
    expect(a.status).toBe('ERROR'); expect(b.status).toBe('ERROR')
    expect(call).toHaveBeenCalledTimes(2)
    expect(await used()).toBe(2) // as duas tentativas contam: o provedor pode ter contabilizado
  })

  it('sem orçamento: não chama, libera o claim e informa quando volta', async () => {
    Object.assign(env, { TAVILY_MONTHLY_BUDGET: 1 })
    await guardedCall(base(async () => ['a'], { cacheKey: 'k1' }))
    const call = vi.fn(async () => ['b'])
    const r = await guardedCall(base(call, { cacheKey: 'k2' }))
    expect(r.status).toBe('BLOCKED')
    if (r.status === 'BLOCKED') { expect(r.block.code).toBe('WINDOW_M'); expect(r.block.retryAt).toBeInstanceOf(Date) }
    expect(call).not.toHaveBeenCalled()
    expect(await cache.claim('k2', 'TAVILY', 'SEARCH_BASIC', 1000)).toEqual(expect.any(String)) // claim liberado
  })

  it('claim VENCIDO adquirido por outro: o dono anterior não libera nem sobrescreve o claim do novo', async () => {
    const key = base(async () => []).cacheKey
    const old = (await cache.claim(key, 'TAVILY', 'SEARCH_BASIC', 1)) as string // dono antigo, claim de 1 ms
    await new Promise((r) => setTimeout(r, 5))
    const fresh = (await cache.claim(key, 'TAVILY', 'SEARCH_BASIC', 60_000)) as string // venceu: o novo worker adquire
    expect(fresh).toBeTruthy(); expect(fresh).not.toBe(old)
    await cache.release(key, old) // o antigo tenta liberar
    expect(await cache.claim(key, 'TAVILY', 'SEARCH_BASIC', 60_000)).toBeNull() // claim do novo continua de pé
    expect(await cache.put(key, 'TAVILY', 'SEARCH_BASIC', ['velho'], 'POSITIVE', 3600_000, old)).toBe(false) // nem sobrescreve
    expect(await cache.get(key)).toBeNull()
    expect(await cache.put(key, 'TAVILY', 'SEARCH_BASIC', ['novo'], 'POSITIVE', 3600_000, fresh)).toBe(true)
    expect((await cache.get(key))?.response).toEqual(['novo'])
  })

  it('guardedCall: worker cujo claim venceu durante a chamada usa a resposta mas NÃO sobrescreve o cache do novo dono', async () => {
    const key = base(async () => []).cacheKey
    const r = await guardedCall(base(async () => {
      await new Promise((res) => setTimeout(res, 5))
      cache.rows.set(key, { ...(cache.rows.get(key) as object), response: null, inFlightUntil: Date.now() + 60_000, token: 'outro-worker' } as never) // outro assumiu o claim
      return ['do-antigo']
    }, { cacheKey: key, claimMs: 1 }))
    expect(r.status).toBe('OK')
    expect(await cache.get(key)).toBeNull() // o cache não foi sobrescrito pelo dono antigo
    expect(cache.rows.get(key)?.token).toBe('outro-worker')
  })

  it('auth inválida pausa a integração (sem retry infinito); rate limit e limite de plano têm status próprios', async () => {
    expect((await guardedCall(base(async () => { throw new ProviderAuthError('401') }, { cacheKey: 'a' }))).status).toBe('AUTH')
    expect(pauseCalls).toEqual(['TAVILY'])
    expect((await guardedCall(base(async () => { throw new ProviderRateLimitError('429', 5000) }, { cacheKey: 'b' }))).status).toBe('RATE_LIMITED')
    expect((await guardedCall(base(async () => { throw new ProviderPlanLimitError('432') }, { cacheKey: 'c' }))).status).toBe('PLAN_LIMIT')
  })

  it('banco de cache/claim indisponível: não chama o provedor sem trava (fail-closed)', async () => {
    const broken: CacheStore = { get: async () => { throw new Error('x') }, claim: async () => { throw new Error('x') }, put: async () => true, release: async () => {} }
    setCacheStore(broken)
    const call = vi.fn(async () => ['q'])
    const r = await guardedCall(base(call, { cacheKey: 'z' }))
    expect(r.status).toBe('BLOCKED')
    expect(call).not.toHaveBeenCalled()
  })

  it('a chave de cache normaliza acento/caixa/espaços e muda com os parâmetros', () => {
    const a = cacheKeyOf('TAVILY', 'SEARCH_BASIC', 'v1', { q: '  Arena   Tribo Tubarão ', depth: 'basic' })
    const b = cacheKeyOf('TAVILY', 'SEARCH_BASIC', 'v1', { depth: 'basic', q: 'arena tribo tubarao' })
    expect(a).toBe(b)
    expect(cacheKeyOf('TAVILY', 'SEARCH_BASIC', 'v1', { q: 'arena tribo tubarao', depth: 'advanced' })).not.toBe(a)
    expect(cacheKeyOf('TAVILY', 'SEARCH_BASIC', 'v2', { q: 'arena tribo tubarao', depth: 'basic' })).not.toBe(a)
  })
})
