// Estado operacional das integrações. Auth inválida (401, token Meta expirado...) PAUSA o provedor: nada mais é chamado
// até alguém corrigir a credencial e retomar — sem retries infinitos, e visível na tela de consumo.
import { prisma } from '../config/database'
import type { Provider } from './api-quota.service'

export interface PauseInfo { provider: string; reason: string | null; since: Date }

const CACHE_MS = 3000
let cache: { at: number; map: Map<string, PauseInfo> } | null = null

async function load(): Promise<Map<string, PauseInfo>> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.map
  const map = new Map<string, PauseInfo>()
  try {
    const rows = await prisma.providerState.findMany({ where: { status: { not: 'ACTIVE' } } })
    for (const r of rows) map.set(r.provider, { provider: r.provider, reason: r.reason, since: r.since })
    cache = { at: Date.now(), map }
  } catch (e) {
    // Sem ler o estado, assume o último conhecido (ou ativo): quem protege o orçamento é a reserva, que falha fechada.
    console.error('[provider-state] falha ao ler:', (e as Error).message)
    return cache?.map ?? map
  }
  return map
}

export async function getProviderPause(provider: Provider | string): Promise<PauseInfo | null> {
  return (await load()).get(provider) ?? null
}

export async function listProviderStates(): Promise<PauseInfo[]> {
  return [...(await load()).values()]
}

export async function pauseProvider(provider: Provider | string, reason: string): Promise<void> {
  await prisma.providerState.upsert({ where: { provider }, create: { provider, status: 'PAUSED_AUTH', reason: reason.slice(0, 300) }, update: { status: 'PAUSED_AUTH', reason: reason.slice(0, 300), since: new Date() } })
  cache = null
  console.error(`[provider-state] ${provider} PAUSADO: ${reason}`)
}

export async function resumeProvider(provider: Provider | string): Promise<void> {
  await prisma.providerState.upsert({ where: { provider }, create: { provider, status: 'ACTIVE' }, update: { status: 'ACTIVE', reason: null, since: new Date() } })
  cache = null
}

export function _resetProviderStateForTests(): void { cache = null }
