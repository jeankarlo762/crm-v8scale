// Business Discovery (Instagram Graph API): dado um @username, devolve site/seguidores/posts/bio de uma conta
// Business ou Creator, consultando a partir da nossa conta Instagram Business (META_IG_BUSINESS_ID).
// Conta inexistente ou pessoal não é erro: devolve null. Rate limit e falhas de auth/rede lançam BusinessDiscoveryError.
import { env } from '../config/env'
import { OPERATIONS, type QuotaRun } from './api-quota.service'
import { cacheKeyOf, guardedCall, ProviderAuthError, ProviderRateLimitError, type GuardedResult } from './api-guard.service'

const GRAPH_URL = 'https://graph.facebook.com/v21.0'
const TIMEOUT_MS = 15000

export interface BusinessDiscoveryResult {
  username: string
  website: string | null
  followersCount: number | null
  mediaCount: number | null
  biography: string | null
}

export class BusinessDiscoveryError extends Error {
  constructor(message: string, readonly kind: 'rate_limit' | 'auth' | 'config' | 'network' | 'unknown', readonly code?: number) {
    super(message)
    this.name = 'BusinessDiscoveryError'
  }
}

interface GraphError { message?: string; code?: number; error_subcode?: number; type?: string }

// Rate limit da Graph API: 4 (app), 17 (usuário), 32 (página/IG), 613 (custom), 80002 (Instagram).
const RATE_LIMIT_CODES = new Set([4, 17, 32, 613, 80002])
// Token inválido/expirado ou sem permissão.
const AUTH_CODES = new Set([10, 102, 190, 200])

export function isBusinessDiscoveryConfigured(): boolean {
  return !!process.env.META_IG_BUSINESS_ID && !!process.env.META_ACCESS_TOKEN
}

export function normalizeUsername(raw: string): string {
  return raw.trim().replace(/^@/, '').replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/[/?#].*$/, '').toLowerCase()
}

// Conta não encontrada / não é Business ou Creator: a Graph API responde 400 com code 110 ou subcode 2207013/2207001,
// ou a mensagem "Invalid user id" / "Unsupported get request" sem ser rate limit ou auth.
function isNotFound(e: GraphError): boolean {
  if (e.code === 110 || e.error_subcode === 2207013 || e.error_subcode === 2207001) return true
  return e.code === 100 && /invalid user id|cannot be found|does not exist|not a business|unsupported get request|business_discovery/i.test(e.message ?? '')
}

export async function getBusinessDiscovery(rawUsername: string): Promise<BusinessDiscoveryResult | null> {
  const username = normalizeUsername(rawUsername)
  if (!username) return null
  const { META_IG_BUSINESS_ID: igId, META_ACCESS_TOKEN: token } = process.env
  if (!igId || !token) throw new BusinessDiscoveryError('META_IG_BUSINESS_ID e META_ACCESS_TOKEN precisam estar no .env', 'config')

  const fields = `business_discovery.username(${username}){username,website,followers_count,media_count,biography}`
  const url = `${GRAPH_URL}/${igId}?${new URLSearchParams({ fields, access_token: token })}`
  let res: Response
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })
  } catch (e) {
    throw new BusinessDiscoveryError(`falha de rede na Graph API: ${(e as Error).message}`, 'network')
  }
  const body = (await res.json().catch(() => null)) as { business_discovery?: Record<string, unknown>; error?: GraphError } | null

  if (!res.ok || body?.error) {
    const err = body?.error ?? {}
    if ((err.code !== undefined && RATE_LIMIT_CODES.has(err.code)) || res.status === 429) {
      throw new BusinessDiscoveryError(`rate limit da Graph API (code ${err.code ?? res.status}): ${err.message ?? ''}`, 'rate_limit', err.code)
    }
    if (err.code !== undefined && AUTH_CODES.has(err.code) && !isNotFound(err)) {
      throw new BusinessDiscoveryError(`token/permissão inválidos (code ${err.code}): ${err.message ?? ''}`, 'auth', err.code)
    }
    if (isNotFound(err) || res.status === 400 || res.status === 404) return null
    throw new BusinessDiscoveryError(`Graph API HTTP ${res.status}: ${err.message ?? 'erro desconhecido'}`, 'unknown', err.code)
  }

  const bd = body?.business_discovery
  if (!bd) return null
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
  const num = (v: unknown) => (typeof v === 'number' ? v : null)
  return {
    username: str(bd.username) ?? username,
    website: str(bd.website),
    followersCount: num(bd.followers_count),
    mediaCount: num(bd.media_count),
    biography: str(bd.biography),
  }
}

// Consulta com cache persistente (por @), dedupe e reserva atômica (hora). Conta inexistente/pessoal → found:false (NEGATIVE).
export async function getBusinessDiscoveryGuarded(rawUsername: string, opts: { run?: QuotaRun; refresh?: boolean } = {}): Promise<GuardedResult<{ found: boolean; data: BusinessDiscoveryResult | null }>> {
  const username = normalizeUsername(rawUsername)
  return guardedCall<{ found: boolean; data: BusinessDiscoveryResult | null }>({
    provider: 'META',
    operation: OPERATIONS.META_BUSINESS_DISCOVERY,
    cacheKey: cacheKeyOf('META', OPERATIONS.META_BUSINESS_DISCOVERY, 'v1', { u: username, fields: 'username,website,followers_count,media_count,biography' }),
    run: opts.run,
    refresh: opts.refresh,
    classify: (r) => r.found ? { outcome: 'POSITIVE', ttlMs: env.META_CACHE_TTL_HOURS * 3600_000 } : { outcome: 'NEGATIVE', ttlMs: env.META_CACHE_NEGATIVE_TTL_HOURS * 3600_000 },
    call: async () => {
      try {
        const data = await getBusinessDiscovery(username)
        return { found: !!data, data }
      } catch (e) {
        if (e instanceof BusinessDiscoveryError) {
          if (e.kind === 'auth' || e.kind === 'config') throw new ProviderAuthError(e.message)
          if (e.kind === 'rate_limit') throw new ProviderRateLimitError(e.message)
        }
        throw e
      }
    },
  })
}
