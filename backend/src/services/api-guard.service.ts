// Toda chamada externa paga passa por aqui, nesta ordem:
//  1) cache persistente (consulta normalizada + parâmetros + versão) — SEM reservar orçamento;
//  2) dedupe de chamada concorrente igual (no processo e entre instâncias, via claim no banco, com TOKEN do dono: um
//     worker antigo, cujo claim expirou e foi adquirido por outro, não libera nem sobrescreve o claim do novo);
//  3) reserva atômica de orçamento (api-quota) — a cada tentativa, inclusive retry;
//  4) a chamada. Erro depois da reserva NÃO devolve orçamento (o provedor pode ter contabilizado).
// Cache reutilizado volta marcado fromCache=true e nunca vira "evidência recém-coletada".
import { randomUUID } from 'node:crypto'
import { prisma } from '../config/database'
import { reserve, noteSaved, pauseKeyOf, type Block, type Provider, type QuotaRun } from './api-quota.service'
import { pauseProvider } from './provider-state.service'

// Erros que a função `call` deve lançar para o guard saber o que fazer.
export class ProviderAuthError extends Error {}
export class ProviderRateLimitError extends Error { constructor(m: string, readonly retryAfterMs?: number) { super(m) } }
export class ProviderPlanLimitError extends Error {} // o provedor diz que a franquia/plano acabou (ex.: Tavily 432/433)

export type CacheOutcome = 'POSITIVE' | 'NEGATIVE'
export interface CacheEntry<T = unknown> { response: T; outcome: CacheOutcome; collectedAt: Date; expiresAt: Date }

export interface CacheStore {
  get(key: string): Promise<CacheEntry | null>
  // Devolve o token do claim (null = outra execução detém um claim vigente). Claim vencido pode ser adquirido por outro.
  claim(key: string, provider: string, operation: string, ms: number): Promise<string | null>
  // Só grava se `token` ainda é o dono do claim; devolve false (e não escreve) caso contrário.
  put(key: string, provider: string, operation: string, response: unknown, outcome: CacheOutcome, ttlMs: number, token: string): Promise<boolean>
  release(key: string, token: string): Promise<void>
}

export const prismaCacheStore: CacheStore = {
  async get(key) {
    const r = await prisma.apiCache.findUnique({ where: { key } })
    if (!r || r.response == null || !r.expiresAt || r.expiresAt.getTime() <= Date.now()) return null
    return { response: r.response, outcome: (r.outcome as CacheOutcome) ?? 'POSITIVE', collectedAt: r.collectedAt ?? r.updatedAt, expiresAt: r.expiresAt }
  },
  async claim(key, provider, operation, ms) {
    const secs = Math.ceil(ms / 1000)
    const token = randomUUID()
    const rows = await prisma.$queryRaw<{ key: string }[]>`
      INSERT INTO "ApiCache" ("key","provider","operation","inFlightUntil","claimToken","updatedAt") VALUES (${key}, ${provider}, ${operation}, (now() AT TIME ZONE 'UTC') + (${secs} * interval '1 second'), ${token}, (now() AT TIME ZONE 'UTC'))
      ON CONFLICT ("key") DO UPDATE SET "inFlightUntil" = EXCLUDED."inFlightUntil", "claimToken" = EXCLUDED."claimToken", "updatedAt" = (now() AT TIME ZONE 'UTC')
      WHERE "ApiCache"."inFlightUntil" IS NULL OR "ApiCache"."inFlightUntil" < (now() AT TIME ZONE 'UTC')
      RETURNING "key"`
    return rows.length > 0 ? token : null
  },
  async put(key, _provider, _operation, response, outcome, ttlMs, token) {
    const now = new Date()
    const r = await prisma.apiCache.updateMany({
      where: { key, claimToken: token },
      data: { response: response as object, outcome, collectedAt: now, expiresAt: new Date(now.getTime() + ttlMs), inFlightUntil: null, claimToken: null },
    })
    return r.count > 0
  },
  async release(key, token) {
    await prisma.apiCache.updateMany({ where: { key, claimToken: token }, data: { inFlightUntil: null, claimToken: null } })
  },
}

export class MemoryCacheStore implements CacheStore {
  rows = new Map<string, CacheEntry & { inFlightUntil?: number; token?: string }>()
  async get(key: string) { const r = this.rows.get(key); return r && r.response != null && r.expiresAt.getTime() > Date.now() ? r : null }
  async claim(key: string, _p: string, _o: string, ms: number) {
    const r = this.rows.get(key)
    if (r?.inFlightUntil && r.inFlightUntil > Date.now()) return null
    const token = randomUUID()
    this.rows.set(key, { ...(r ?? { response: null, outcome: 'POSITIVE', collectedAt: new Date(0), expiresAt: new Date(0) }), inFlightUntil: Date.now() + ms, token })
    return token
  }
  async put(key: string, _p: string, _o: string, response: unknown, outcome: CacheOutcome, ttlMs: number, token: string) {
    if (this.rows.get(key)?.token !== token) return false
    this.rows.set(key, { response, outcome, collectedAt: new Date(), expiresAt: new Date(Date.now() + ttlMs) })
    return true
  }
  async release(key: string, token: string) { const r = this.rows.get(key); if (r && r.token === token) { delete r.inFlightUntil; delete r.token } }
}

let cacheStore: CacheStore = prismaCacheStore
export function setCacheStore(s: CacheStore): void { cacheStore = s }

export interface GuardedOptions<T> {
  provider: Provider
  operation: string
  cacheKey: string // já normalizada e versionada (ver cacheKeyOf)
  classify: (data: T) => { outcome: CacheOutcome; ttlMs: number } // ttlMs 0 = não cacheia
  call: () => Promise<T>
  run?: QuotaRun
  refresh?: boolean // ignora o cache LIDO (ex.: reverificar), mas continua reservando orçamento
  claimMs?: number
}

export type GuardedResult<T> =
  | { status: 'OK'; data: T; fromCache: boolean; collectedAt: Date; outcome: CacheOutcome }
  | { status: 'BLOCKED'; block: Block }
  | { status: 'IN_FLIGHT' } // outra instância está fazendo a mesma consulta: tente mais tarde
  | { status: 'RATE_LIMITED'; error: Error; retryAfterMs?: number } // tentativa gasta (reservada)
  | { status: 'PLAN_LIMIT'; error: Error } // provedor diz que a franquia acabou: trate como cota esgotada
  | { status: 'AUTH'; error: Error } // credencial inválida: provedor pausado
  | { status: 'ERROR'; error: Error } // falha técnica; a reserva foi consumida

export function cacheKeyOf(provider: string, operation: string, version: string, params: Record<string, unknown>): string {
  const norm = Object.keys(params).sort().map((k) => `${k}=${typeof params[k] === 'string' ? (params[k] as string).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim() : JSON.stringify(params[k])}`).join('&')
  return `${provider}|${operation}|${version}|${norm}`
}

const inflight = new Map<string, Promise<GuardedResult<unknown>>>()

export async function guardedCall<T>(o: GuardedOptions<T>): Promise<GuardedResult<T>> {
  const existing = inflight.get(o.cacheKey)
  if (existing) return existing as Promise<GuardedResult<T>> // mesma consulta em andamento neste processo: compartilha, sem 2ª reserva
  const p = execute(o).finally(() => inflight.delete(o.cacheKey))
  inflight.set(o.cacheKey, p as Promise<GuardedResult<unknown>>)
  return p
}

async function execute<T>(o: GuardedOptions<T>): Promise<GuardedResult<T>> {
  if (!o.refresh) {
    try {
      const hit = await cacheStore.get(o.cacheKey)
      if (hit) { noteSaved('callsSavedByCache'); return { status: 'OK', data: hit.response as T, fromCache: true, collectedAt: hit.collectedAt, outcome: hit.outcome } }
    } catch (e) { console.error('[api-guard] cache indisponível (segue sem cache):', (e as Error).message) }
  }
  let token: string | null
  try {
    token = await cacheStore.claim(o.cacheKey, o.provider, o.operation, o.claimMs ?? 90_000)
  } catch (e) {
    return { status: 'BLOCKED', block: { code: 'STORE_ERROR', detail: `não foi possível travar a consulta (bloqueado por segurança): ${(e as Error).message}`, retryAt: new Date(Date.now() + 60_000) } }
  }
  if (!token) return { status: 'IN_FLIGHT' }
  const owned = token
  const release = () => cacheStore.release(o.cacheKey, owned).catch(() => {})
  const r = await reserve(o.provider, { operation: o.operation, run: o.run })
  if (!r.ok) { await release(); return { status: 'BLOCKED', block: { code: r.code, detail: r.detail, retryAt: r.retryAt } } }
  try {
    const data = await o.call()
    const { outcome, ttlMs } = o.classify(data)
    const collectedAt = new Date()
    // O dono do claim pode ter mudado (claim vencido durante a chamada): então NÃO sobrescreve o cache do novo dono.
    if (ttlMs > 0) {
      const wrote = await cacheStore.put(o.cacheKey, o.provider, o.operation, data, outcome, ttlMs, owned).catch((e) => { console.error('[api-guard] não gravou cache:', (e as Error).message); return true })
      if (!wrote) console.warn(`[api-guard] claim de "${o.cacheKey.slice(0, 60)}" perdido durante a chamada: resposta usada, cache do novo dono preservado`)
    } else await release()
    return { status: 'OK', data, fromCache: false, collectedAt, outcome }
  } catch (e) {
    await release() // libera o claim; o orçamento reservado NÃO volta
    const err = e instanceof Error ? e : new Error(String(e))
    if (e instanceof ProviderAuthError) { await pauseProvider(pauseKeyOf(o.provider), err.message).catch(() => {}); return { status: 'AUTH', error: err } }
    if (e instanceof ProviderRateLimitError) return { status: 'RATE_LIMITED', error: err, retryAfterMs: e.retryAfterMs }
    if (e instanceof ProviderPlanLimitError) return { status: 'PLAN_LIMIT', error: err }
    return { status: 'ERROR', error: err }
  }
}
