// Orçamento INTERNO das APIs externas (Google Places, Tavily, Meta). Limites vêm do env e são conservadores e
// configuráveis — NÃO são os limites reais do provedor (esses o provedor aplica; aqui só travamos antes).
//
// Garantias:
//  - reserva ATÔMICA no banco compartilhado (ApiUsage): hora, mês (e operação) são checados e incrementados na
//    mesma transação com SELECT ... FOR UPDATE; workers/instâncias concorrentes não passam do teto;
//  - toda tentativa externa (inclusive retry) reserva; NÃO existe devolução: após erro não há garantia de que o provedor
//    não contabilizou a chamada;
//  - sem orçamento válido o provedor fica BLOQUEADO com motivo claro (nunca opera sem teto); `force` não passa por aqui;
//  - falha do armazenamento = bloqueia (fail-closed).
//  - o CICLO de reset de cada provedor é configuração explícita (*_QUOTA_RESET/_TZ, ver quota-cycle.ts); sem ele, ou com
//    valor inválido, o provedor fica BLOQUEADO. Limite móvel (ROLLING) usa política conservadora (soma de baldes finos).
// LIMITAÇÕES: (1) consumo de outras aplicações/console com a mesma chave não é observável — use *_EXTERNAL_RESERVED
// (obrigatório se *_QUOTA_SHARED=true) e *_PRIOR_USAGE/_UNTIL para o que veio antes deste contador; (2) o ciclo real do
// provedor precisa ser conferido no console: a configuração é a nossa declaração, não uma leitura do provedor.
import { Prisma } from '@prisma/client'
import { prisma } from '../config/database'
import { env } from '../config/env'
import { getProviderPause } from './provider-state.service'
import { parseCycle, windowSpec, type CycleConfig, type WindowSpec } from './quota-cycle'
import type { SourceState } from './website-types'

export type { SourceState }
export type Provider = 'GOOGLE_TEXT_SEARCH_PRO' | 'GOOGLE_PLACE_DETAILS_ENTERPRISE' | 'TAVILY' | 'META'
export type Window = 'H' | 'M'
export const PROVIDERS: Provider[] = ['GOOGLE_TEXT_SEARCH_PRO', 'GOOGLE_PLACE_DETAILS_ENTERPRISE', 'TAVILY', 'META']
// Credencial/pausa por autenticação: as duas operações do Google usam a MESMA chave, então pausam juntas.
export const pauseKeyOf = (p: Provider): string => (p.startsWith('GOOGLE_') ? 'GOOGLE_PLACES' : p)
export const WINDOWS: Window[] = ['H', 'M']

// Janelas sem as quais o provedor não opera. Google/Tavily: franquia mensal; Meta: limite por hora.
export const REQUIRED_WINDOWS: Record<Provider, Window[]> = { GOOGLE_TEXT_SEARCH_PRO: ['M'], GOOGLE_PLACE_DETAILS_ENTERPRISE: ['M'], TAVILY: ['M'], META: ['H'] }

// Operação (SKU/endpoint) realmente usada. Google: descoberta só com campos Pro; telefone/website/nota/avaliações só no Details Enterprise.
export const OPERATIONS = {
  GOOGLE_TEXT_SEARCH: 'TEXT_SEARCH_PRO',
  GOOGLE_PLACE_DETAILS: 'PLACE_DETAILS_ENTERPRISE', // telefone, website, nota e avaliações de leads PRIORIZADOS
  TAVILY_SEARCH: 'SEARCH_BASIC', // search_depth=basic: 1 crédito (advanced = 2)
  META_BUSINESS_DISCOVERY: 'BUSINESS_DISCOVERY',
} as const

// Franquias gratuitas documentadas (verificadas em 2026-10-01 nas páginas oficiais de preços). Teto duro por padrão.
export const DOCUMENTED_FREE_CAP: Partial<Record<Provider, { M: number; note: string }>> = {
  GOOGLE_TEXT_SEARCH_PRO: { M: 5000, note: 'Places API (New) Text Search Pro (id, nome, endereço, status, tipos, link): 5.000 eventos/mês grátis.' },
  GOOGLE_PLACE_DETAILS_ENTERPRISE: { M: 1000, note: 'Places API (New) Place Details Enterprise (telefone, website, nota, avaliações): 1.000 eventos/mês grátis.' },
  TAVILY: { M: 1000, note: 'Tavily Researcher gratuito: 1.000 créditos/mês; search basic = 1 crédito, advanced = 2.' },
}

export const LIMITATIONS = [
  'Consumo externo (outros apps/console com a mesma chave) não é observável aqui: use *_EXTERNAL_RESERVED e um orçamento local abaixo da franquia.',
  'O ciclo de reset (fuso, dia de cobrança, limite móvel) é configurado por provedor (*_QUOTA_RESET/_TZ) e precisa ser conferido no console do provedor.',
  'Consumo anterior ao contador: informe *_PRIOR_USAGE e *_PRIOR_USAGE_UNTIL (quando sai da janela do provedor).',
  'O orçamento local não é o limite do provedor: é um teto de processamento nosso.',
]

type Budgets = Partial<Record<Window, number>>
const GOOGLE_ENV = {
  GOOGLE_TEXT_SEARCH_PRO: () => ({ b: { H: env.GOOGLE_TEXT_SEARCH_PRO_HOURLY_BUDGET, M: env.GOOGLE_TEXT_SEARCH_PRO_MONTHLY_BUDGET }, ext: env.GOOGLE_TEXT_SEARCH_PRO_EXTERNAL_RESERVED, pn: env.GOOGLE_TEXT_SEARCH_PRO_PRIOR_USAGE, pu: env.GOOGLE_TEXT_SEARCH_PRO_PRIOR_USAGE_UNTIL }),
  GOOGLE_PLACE_DETAILS_ENTERPRISE: () => ({ b: { H: env.GOOGLE_PLACE_DETAILS_ENTERPRISE_HOURLY_BUDGET, M: env.GOOGLE_PLACE_DETAILS_ENTERPRISE_MONTHLY_BUDGET }, ext: env.GOOGLE_PLACE_DETAILS_ENTERPRISE_EXTERNAL_RESERVED, pn: env.GOOGLE_PLACE_DETAILS_ENTERPRISE_PRIOR_USAGE, pu: env.GOOGLE_PLACE_DETAILS_ENTERPRISE_PRIOR_USAGE_UNTIL }),
} as const
const isGoogle = (p: Provider): p is keyof typeof GOOGLE_ENV => p in GOOGLE_ENV

export function budgetsOf(provider: Provider): Budgets {
  const e = env
  if (isGoogle(provider)) return GOOGLE_ENV[provider]().b
  const b = {
    TAVILY: { H: e.TAVILY_HOURLY_BUDGET, M: e.TAVILY_MONTHLY_BUDGET },
    META: { H: e.META_HOURLY_BUDGET, M: e.META_MONTHLY_BUDGET },
  }
  return b[provider]
}

function externalReserved(provider: Provider): number {
  return isGoogle(provider) ? GOOGLE_ENV[provider]().ext ?? 0 : provider === 'TAVILY' ? env.TAVILY_EXTERNAL_RESERVED ?? 0 : 0
}

// Consumo anterior ao contador que ainda está dentro da janela do provedor (até *_PRIOR_USAGE_UNTIL).
function priorOf(provider: Provider): { n: number | undefined; until: string | undefined } {
  if (isGoogle(provider)) { const g = GOOGLE_ENV[provider](); return { n: g.pn, until: g.pu } }
  return provider === 'TAVILY' ? { n: env.TAVILY_PRIOR_USAGE, until: env.TAVILY_PRIOR_USAGE_UNTIL } : { n: undefined, until: undefined }
}
function priorUsage(provider: Provider, now: Date): number {
  const { n, until } = priorOf(provider)
  if (!n || !until) return 0
  const t = Date.parse(until)
  return Number.isFinite(t) && now.getTime() < t ? n : 0
}

// Orçamento efetivo = configurado − margem de segurança − consumo externo reservado − consumo anterior ainda na janela (só mensal).
export function effectiveLimit(provider: Provider, w: Window, limit: number, now = new Date()): number {
  const afterMargin = Math.floor(limit * (100 - (env.API_QUOTA_SAFETY_PERCENT ?? 10)) / 100)
  return Math.max(0, w === 'M' ? afterMargin - externalReserved(provider) - priorUsage(provider, now) : afterMargin)
}

export function cycleOf(provider: Provider): { ok: true; value: CycleConfig } | { ok: false; error: string } {
  const [reset, tz] = isGoogle(provider) ? [env.GOOGLE_PLACES_QUOTA_RESET, env.GOOGLE_PLACES_QUOTA_TZ] : provider === 'TAVILY' ? [env.TAVILY_QUOTA_RESET, env.TAVILY_QUOTA_TZ] : [env.META_QUOTA_RESET, env.META_QUOTA_TZ]
  const c = parseCycle(reset, tz)
  if (c.ok && provider === 'META' && c.value.mode === 'ANCHOR_DAY') return { ok: false, error: 'ANCHOR_DAY só vale para janela mensal; a Meta usa hora (FIXED ou ROLLING)' }
  return c
}

export function operationBudgets(): { ok: true; value: Record<string, Budgets> } | { ok: false; error: string } {
  if (!env.API_OPERATION_BUDGETS) return { ok: true, value: {} }
  try {
    const v = JSON.parse(env.API_OPERATION_BUDGETS) as Record<string, Budgets>
    for (const [k, b] of Object.entries(v)) {
      if (!/^[A-Z_]+:[A-Z_]+$/.test(k) || !b || typeof b !== 'object') throw new Error(`entrada inválida: ${k}`)
      for (const [w, n] of Object.entries(b)) if (!WINDOWS.includes(w as Window) || !Number.isInteger(n) || n <= 0) throw new Error(`janela/valor inválido em ${k}`)
    }
    return { ok: true, value: v }
  } catch (e) {
    return { ok: false, error: `API_OPERATION_BUDGETS inválido: ${(e as Error).message}` }
  }
}

export type BlockCode = 'NOT_CONFIGURED' | 'ABOVE_DOCUMENTED_CAP' | 'INVALID_CONFIG' | 'PROVIDER_PAUSED' | 'WINDOW_H' | 'WINDOW_M' | 'OPERATION_LIMIT' | 'RUN_LIMIT' | 'STORE_ERROR' | 'CONFIG_CHANGED'
export interface Block { code: BlockCode; detail: string; retryAt: Date | null }
export type ReserveResult = { ok: true } | ({ ok: false } & Block)

// Fim da janela de calendário UTC corrente (compatibilidade); o retomar real usa windowSpec do ciclo configurado.
export function windowEnd(w: Window, now = new Date()): Date {
  return windowSpec({ mode: 'FIXED', tz: 'UTC' }, w, now).end
}

export function windowKey(provider: Provider, w: Window, now = new Date(), operation?: string, cycle: CycleConfig = { mode: 'FIXED', tz: 'UTC' }): string {
  return keyOf(provider, w, windowSpec(cycle, w, now).key, operation, cycle.mode === 'ROLLING')
}
function keyOf(provider: Provider, w: Window, bucket: string, operation: string | undefined, rolling: boolean): string {
  const win = rolling ? `${w}R` : w
  return operation ? `${provider}|${operation}|${win}|${bucket}` : `${provider}|${win}|${bucket}`
}

// Configuração do provedor (sem tocar no banco): null = pode operar.
export function configBlock(provider: Provider): Block | null {
  const ops = operationBudgets()
  if (!ops.ok) return { code: 'INVALID_CONFIG', detail: ops.error, retryAt: null }
  const b = budgetsOf(provider)
  const missing = REQUIRED_WINDOWS[provider].filter((w) => b[w] == null)
  if (missing.length) {
    return { code: 'NOT_CONFIGURED', detail: `${provider}: orçamento obrigatório ausente (${missing.map((w) => `${provider}_${{ H: 'HOURLY', M: 'MONTHLY' }[w]}_BUDGET`).join(', ')}). Provedor bloqueado até configurar.`, retryAt: null }
  }
  const cyc = cycleOf(provider)
  if (!cyc.ok) {
    return { code: 'INVALID_CONFIG', detail: `${provider}: ${cyc.error}. Defina ${provider}_QUOTA_RESET (FIXED | ANCHOR_DAY:<n> | ROLLING) e ${provider}_QUOTA_TZ conferindo o ciclo real no console do provedor. Provedor bloqueado até configurar.`, retryAt: null }
  }
  const sharedExt = isGoogle(provider) ? [env.GOOGLE_PLACES_QUOTA_SHARED, GOOGLE_ENV[provider]().ext] : provider === 'TAVILY' ? [env.TAVILY_QUOTA_SHARED, env.TAVILY_EXTERNAL_RESERVED] : null
  if (sharedExt && sharedExt[0] === 'true' && sharedExt[1] == null) {
    return { code: 'INVALID_CONFIG', detail: `${provider}: o projeto/conta é compartilhado (QUOTA_SHARED=true) e exige ${provider}_EXTERNAL_RESERVED explícito (consumo das outras aplicações).`, retryAt: null }
  }
  const { n: priorN, until: priorUntil } = priorOf(provider)
  if ((priorN != null) !== (priorUntil != null) || (priorUntil != null && !Number.isFinite(Date.parse(priorUntil)))) {
    return { code: 'INVALID_CONFIG', detail: `${provider}: ${provider}_PRIOR_USAGE e ${provider}_PRIOR_USAGE_UNTIL (data ISO válida) devem ser informados juntos.`, retryAt: null }
  }
  const cap = DOCUMENTED_FREE_CAP[provider]
  if (cap && b.M != null && b.M > cap.M && env.API_QUOTA_ALLOW_ABOVE_DOCUMENTED_CAP !== 'true') {
    return { code: 'ABOVE_DOCUMENTED_CAP', detail: `${provider}: orçamento mensal ${b.M} acima da franquia gratuita documentada (${cap.M}). ${cap.note} Reduza o orçamento ou defina API_QUOTA_ALLOW_ABOVE_DOCUMENTED_CAP=true conscientemente.`, retryAt: null }
  }
  return null
}

// ── Mudança de ciclo: nunca zera o consumo em silêncio ─────────────────────────────────────────────
// Os contadores são gravados em baldes cuja chave depende do ciclo (fuso, âncora). Trocar QUOTA_RESET/TZ/âncora muda as
// chaves e o consumo já feito "desapareceria". Por isso a impressão digital do ciclo fica registrada: se a configuração
// atual difere dela, o provedor BLOQUEIA (CONFIG_CHANGED) e o histórico é preservado até a reconciliação explícita.
export const LEGACY_CYCLE_FINGERPRINT = 'FIXED|UTC' // antes do ciclo configurável os contadores eram sempre calendário UTC
export function cycleFingerprint(c: CycleConfig): string {
  return c.mode === 'ROLLING' ? 'ROLLING' : c.mode === 'ANCHOR_DAY' ? `ANCHOR_DAY:${c.anchorDay}|${c.tz}` : `FIXED|${c.tz}`
}

async function configChangeBlock(provider: Provider): Promise<Block | null> {
  const cyc = cycleOf(provider)
  if (!cyc.ok) return null // configBlock já explica
  const cur = cycleFingerprint(cyc.value)
  try {
    const rec = await store.getConfig(provider)
    if (!rec) {
      // O contador do Google era UM só (GOOGLE_PLACES, SKU Enterprise misto). As duas operações novas começam do zero: se o
      // contador antigo tem consumo, ele NÃO pode ser ignorado — reconcilie declarando o consumo atual de cada operação.
      if (isGoogle(provider) && (await store.hasUsage('GOOGLE_PLACES'))) {
        return { code: 'CONFIG_CHANGED', detail: `${provider}: existe consumo no contador antigo do Google (GOOGLE_PLACES, operação única). Bloqueado até reconciliar o consumo de cada operação nova (prisma/reconcile-quota.ts --provider ${provider} --used M=<n> --note "...").`, retryAt: null }
      }
      if (cur === LEGACY_CYCLE_FINGERPRINT || !(await store.hasUsage(provider))) { await store.initConfig(provider, cur); return null }
      return { code: 'CONFIG_CHANGED', detail: `${provider}: já existe consumo contabilizado (ciclo anterior ${LEGACY_CYCLE_FINGERPRINT}) e a configuração agora é ${cur}. Bloqueado até reconciliar o consumo (reconcileQuotaConfig / prisma/reconcile-quota.ts).`, retryAt: null }
    }
    if (rec.fingerprint !== cur) {
      return { code: 'CONFIG_CHANGED', detail: `${provider}: o ciclo mudou de ${rec.fingerprint} para ${cur}. Bloqueado (o consumo anterior foi preservado) até reconciliar explicitamente o consumo do ciclo atual (reconcileQuotaConfig / prisma/reconcile-quota.ts).`, retryAt: null }
    }
    return null
  } catch (e) {
    return { code: 'STORE_ERROR', detail: `não foi possível verificar o ciclo registrado: ${(e as Error).message}`, retryAt: new Date(Date.now() + 60_000) }
  }
}

// Reconciliação EXPLÍCITA: o operador informa quanto já foi consumido no ciclo ATUAL (console do provedor) em cada janela
// obrigatória; o contador nunca fica abaixo disso e a impressão digital passa à configuração atual. O histórico é mantido.
export async function reconcileQuotaConfig(provider: Provider, used: Partial<Record<Window, number>>, note: string, now = new Date()): Promise<{ fingerprint: string; applied: Record<string, number> }> {
  const cfg = configBlock(provider)
  if (cfg) throw new Error(`configuração inválida: ${cfg.detail}`)
  const missing = REQUIRED_WINDOWS[provider].filter((w) => used[w] == null || !Number.isInteger(used[w]) || (used[w] as number) < 0)
  if (missing.length) throw new Error(`informe o consumo atual de cada janela obrigatória (${missing.join(', ')}) — nada é presumido`)
  if (!note.trim()) throw new Error('informe uma nota (quem conferiu e onde: console/data)')
  const cyc = cycleOf(provider) as { ok: true; value: CycleConfig }
  const rolling = cyc.value.mode === 'ROLLING'
  const rows = buildRows(provider, undefined, now, {})
  const keys = keysOf(rows)
  const have = await store.read(keys)
  const adjust: { key: string; set?: number; add?: number }[] = []
  const applied: Record<string, number> = {}
  for (const r of rows) {
    const declared = used[r.window]
    if (declared == null) continue
    applied[r.window] = declared
    if (rolling) adjust.push({ key: r.key, add: Math.max(0, declared - usedOfRow(r, have)) })
    else adjust.push({ key: r.key, set: declared })
  }
  const fingerprint = cycleFingerprint(cyc.value)
  await store.reconcile(provider, fingerprint, adjust, note)
  return { fingerprint, applied }
}

// ── Armazenamento ──────────────────────────────────────────────────────

export interface QuotaRow { key: string; provider: string; limit: number; checkKeys?: string[] } // checkKeys: limite móvel — o teto vale para a SOMA destes baldes (inclui key)
export interface QuotaConfigRecord { fingerprint: string; history: { fingerprint: string; replacedAt: string; note: string }[] }
export interface QuotaStore {
  // Ciclo com que os contadores foram gravados (impressão digital). Mudar a config NÃO pode zerar o consumo em silêncio.
  getConfig(provider: string): Promise<QuotaConfigRecord | null>
  initConfig(provider: string, fingerprint: string): Promise<void> // só se ainda não houver registro
  hasUsage(provider: string): Promise<boolean>
  // Troca a impressão digital e aplica os ajustes de consumo (set = valor mínimo do balde; add = soma) na MESMA transação.
  reconcile(provider: string, fingerprint: string, adjust: { key: string; set?: number; add?: number }[], note: string): Promise<void>
  tryReserve(rows: QuotaRow[], n: number): Promise<{ ok: true } | { ok: false; blockedKey: string; used: number }>
  read(keys: string[]): Promise<Map<string, number>>
}

// Postgres: uma transação — garante a linha, trava TODAS em ordem de chave (sem deadlock), confere cada teto e só então incrementa.
export const prismaQuotaStore: QuotaStore = {
  async getConfig(provider) {
    const r = await prisma.apiQuotaConfig.findUnique({ where: { provider } })
    return r ? { fingerprint: r.fingerprint, history: (r.history as QuotaConfigRecord['history']) ?? [] } : null
  },
  async initConfig(provider, fingerprint) {
    await prisma.$executeRaw`INSERT INTO "ApiQuotaConfig" ("provider","fingerprint","history","updatedAt") VALUES (${provider}, ${fingerprint}, '[]'::jsonb, (now() AT TIME ZONE 'UTC')) ON CONFLICT ("provider") DO NOTHING`
  },
  async hasUsage(provider) { return (await prisma.apiUsage.count({ where: { provider, count: { gt: 0 } } })) > 0 },
  async reconcile(provider, fingerprint, adjust, note) {
    await prisma.$transaction(async (tx) => {
      for (const a of adjust) {
        await tx.$executeRaw`INSERT INTO "ApiUsage" ("key","provider","count","updatedAt") VALUES (${a.key}, ${provider}, 0, (now() AT TIME ZONE 'UTC')) ON CONFLICT ("key") DO NOTHING`
        if (a.set != null) await tx.$executeRaw`UPDATE "ApiUsage" SET "count" = GREATEST("count", ${a.set}), "updatedAt" = (now() AT TIME ZONE 'UTC') WHERE "key" = ${a.key}`
        if (a.add) await tx.$executeRaw`UPDATE "ApiUsage" SET "count" = "count" + ${a.add}, "updatedAt" = (now() AT TIME ZONE 'UTC') WHERE "key" = ${a.key}`
      }
      const prev = await tx.apiQuotaConfig.findUnique({ where: { provider } })
      const history = [...((prev?.history as QuotaConfigRecord['history']) ?? []), ...(prev ? [{ fingerprint: prev.fingerprint, replacedAt: new Date().toISOString(), note }] : [])]
      await tx.apiQuotaConfig.upsert({ where: { provider }, create: { provider, fingerprint, history }, update: { fingerprint, history } })
    })
  },
  async tryReserve(rows, n) {
    return prisma.$transaction(async (tx) => {
      for (const r of rows) {
        await tx.$executeRaw`INSERT INTO "ApiUsage" ("key","provider","count","updatedAt") VALUES (${r.key}, ${r.provider}, 0, (now() AT TIME ZONE 'UTC')) ON CONFLICT ("key") DO NOTHING`
      }
      const incKeys = [...new Set(rows.map((r) => r.key))].sort()
      const allKeys = [...new Set(rows.flatMap((r) => [r.key, ...(r.checkKeys ?? [])]))].sort()
      const cur = await tx.$queryRaw<{ key: string; count: number }[]>`SELECT "key","count" FROM "ApiUsage" WHERE "key" IN (${Prisma.join(allKeys)}) ORDER BY "key" FOR UPDATE`
      const used = new Map(cur.map((c) => [c.key, Number(c.count)]))
      for (const r of [...rows].sort((a, b) => (a.key < b.key ? -1 : 1))) {
        const u = usedOfRow(r, used)
        if (u + n > r.limit) return { ok: false as const, blockedKey: r.key, used: u }
      }
      await tx.$executeRaw`UPDATE "ApiUsage" SET "count" = "count" + ${n}, "updatedAt" = (now() AT TIME ZONE 'UTC') WHERE "key" IN (${Prisma.join(incKeys)})`
      return { ok: true as const }
    })
  },
  async read(keys) {
    if (keys.length === 0) return new Map()
    const rows = await prisma.apiUsage.findMany({ where: { key: { in: keys } } })
    return new Map(rows.map((r) => [r.key, r.count]))
  },
}

// Uso de uma janela: o próprio balde, ou a soma dos baldes (limite móvel).
export const usedOfRow = (r: Pick<QuotaRow, 'key' | 'checkKeys'>, used: Map<string, number>): number =>
  r.checkKeys ? r.checkKeys.reduce((a, k) => a + (used.get(k) ?? 0), 0) : used.get(r.key) ?? 0

// Memória: usada só em testes (a seção crítica é síncrona, equivalente ao FOR UPDATE).
export class MemoryQuotaStore implements QuotaStore {
  counts = new Map<string, number>()
  configs = new Map<string, QuotaConfigRecord>()
  async getConfig(p: string) { return this.configs.get(p) ?? null }
  async initConfig(p: string, fingerprint: string) { if (!this.configs.has(p)) this.configs.set(p, { fingerprint, history: [] }) }
  async hasUsage(p: string) { return [...this.counts.entries()].some(([k, v]) => k.startsWith(`${p}|`) && v > 0) }
  async reconcile(p: string, fingerprint: string, adjust: { key: string; set?: number; add?: number }[], note: string) {
    for (const a of adjust) { if (a.set != null) this.counts.set(a.key, Math.max(this.counts.get(a.key) ?? 0, a.set)); if (a.add) this.counts.set(a.key, (this.counts.get(a.key) ?? 0) + a.add) }
    const prev = this.configs.get(p)
    this.configs.set(p, { fingerprint, history: [...(prev?.history ?? []), ...(prev ? [{ fingerprint: prev.fingerprint, replacedAt: new Date().toISOString(), note }] : [])] })
  }
  async tryReserve(rows: QuotaRow[], n: number) {
    await Promise.resolve() // cede a vez, como uma ida ao banco
    for (const r of rows) {
      const u = usedOfRow(r, this.counts)
      if (u + n > r.limit) return { ok: false as const, blockedKey: r.key, used: u }
    }
    for (const k of new Set(rows.map((r) => r.key))) this.counts.set(k, (this.counts.get(k) ?? 0) + n)
    return { ok: true as const }
  }
  async read(keys: string[]) { return new Map(keys.map((k) => [k, this.counts.get(k) ?? 0])) }
}

let store: QuotaStore = prismaQuotaStore
export function setQuotaStore(s: QuotaStore): void { store = s }

// ── Limite por execução ────────────────────────────────────────────────

// Uma "execução" (lote do worker, clique em Buscar) tem teto próprio por provedor, além das janelas.
export class QuotaRun {
  private used: Partial<Record<Provider, number>> = {}
  constructor(readonly label: string, private readonly caps: Partial<Record<Provider, number>> = defaultRunCaps()) {}
  take(p: Provider, n: number): boolean {
    const cap = this.caps[p]
    if (cap != null && (this.used[p] ?? 0) + n > cap) return false
    this.used[p] = (this.used[p] ?? 0) + n
    return true
  }
  give(p: Provider, n: number): void { this.used[p] = Math.max(0, (this.used[p] ?? 0) - n) } // só quando a chamada externa NÃO ocorreu
  usedOf(p: Provider): number { return this.used[p] ?? 0 }
}
export function defaultRunCaps(): Partial<Record<Provider, number>> {
  return { GOOGLE_TEXT_SEARCH_PRO: env.GOOGLE_TEXT_SEARCH_PRO_MAX_CALLS_PER_RUN, GOOGLE_PLACE_DETAILS_ENTERPRISE: env.GOOGLE_PLACE_DETAILS_ENTERPRISE_MAX_CALLS_PER_RUN, TAVILY: env.TAVILY_MAX_CALLS_PER_RUN, META: env.META_MAX_CALLS_PER_RUN }
}

export const metrics = { callsSavedByCache: 0, callsSavedByShortCircuit: 0, callsSkippedByQuota: 0, callsReserved: 0 }
export function noteSaved(kind: keyof typeof metrics, n = 1): void { metrics[kind] += n }

// Só consulta (não reserva): qual é o bloqueio atual do provedor, se houver? Útil pra decidir a próxima etapa.
export async function currentBlock(provider: Provider, operation?: string): Promise<Block | null> {
  const cfg = configBlock(provider)
  if (cfg) return cfg
  const pause = await getProviderPause(pauseKeyOf(provider))
  if (pause) return { code: 'PROVIDER_PAUSED', detail: `${provider} pausado: ${pause.reason ?? 'autenticação inválida'}`, retryAt: null }
  const changed = await configChangeBlock(provider)
  if (changed) return changed
  const ops = operationBudgets()
  const rows = buildRows(provider, operation, new Date(), ops.ok ? ops.value : {})
  try {
    const used = await store.read(keysOf(rows))
    for (const r of rows) { const u = usedOfRow(r, used); if (u + 1 > r.limit) return blockFor(provider, r, u, new Date()) }
  } catch (e) {
    return { code: 'STORE_ERROR', detail: `não foi possível ler o consumo: ${(e as Error).message}`, retryAt: new Date(Date.now() + 60_000) }
  }
  return null
}

type RowMeta = QuotaRow & { window: Window; operation?: string; spec: WindowSpec }
const keysOf = (rows: QuotaRow[]) => [...new Set(rows.flatMap((r) => [r.key, ...(r.checkKeys ?? [])]))]
function buildRows(provider: Provider, operation: string | undefined, now: Date, ops: Record<string, Budgets>): RowMeta[] {
  const rows: RowMeta[] = []
  const b = budgetsOf(provider)
  const cyc = cycleOf(provider)
  if (!cyc.ok) return rows // configBlock já bloqueia antes de chegar aqui
  const rolling = cyc.value.mode === 'ROLLING'
  const add = (w: Window, limit: number, op?: string) => {
    const spec = windowSpec(cyc.value, w, now)
    rows.push({ key: keyOf(provider, w, spec.key, op, rolling), provider, limit: effectiveLimit(provider, w, limit, now), window: w, operation: op, spec, ...(spec.checkKeys ? { checkKeys: spec.checkKeys.map((k) => keyOf(provider, w, k, op, rolling)) } : {}) })
  }
  for (const w of WINDOWS) if (b[w] != null) add(w, b[w] as number)
  const ob = operation ? ops[`${provider}:${operation}`] : undefined
  if (ob) for (const w of WINDOWS) if (ob[w] != null) add(w, ob[w] as number, operation)
  return rows
}

function blockFor(provider: Provider, r: RowMeta, used: number, _now: Date): Block {
  const code: BlockCode = r.operation ? 'OPERATION_LIMIT' : (`WINDOW_${r.window}` as BlockCode)
  return { code, detail: `${provider}${r.operation ? `/${r.operation}` : ''} sem orçamento (${r.window}: ${used}/${r.limit}; ciclo ${r.spec.cycle})`, retryAt: r.spec.end }
}

// Quanto ainda dá para gastar AGORA em cada janela (efetivo − usado); null se a operação está bloqueada por configuração.
export async function remainingBudget(provider: Provider, now = new Date()): Promise<number | null> {
  if (configBlock(provider) || (await configChangeBlock(provider))) return null
  const rows = buildRows(provider, undefined, now, {})
  const used = await store.read(keysOf(rows))
  return rows.reduce((m, r) => Math.min(m, Math.max(0, r.limit - usedOfRow(r, used))), Infinity)
}

// Reserva atômica: checa e já contabiliza. Chamar ANTES de cada tentativa externa; ok:false = NÃO chame.
export async function reserve(provider: Provider, opts: { operation: string; run?: QuotaRun; n?: number }): Promise<ReserveResult> {
  const n = opts.n ?? 1
  const deny = (b: Block): ReserveResult => { metrics.callsSkippedByQuota += n; console.warn(`[api-quota] ${b.code}: ${b.detail}`); return { ok: false, ...b } }
  const cfg = configBlock(provider)
  if (cfg) return deny(cfg)
  const pause = await getProviderPause(pauseKeyOf(provider))
  if (pause) return deny({ code: 'PROVIDER_PAUSED', detail: `${provider} pausado: ${pause.reason ?? 'autenticação inválida'}`, retryAt: null })
  const changed = await configChangeBlock(provider)
  if (changed) return deny(changed)
  if (opts.run && !opts.run.take(provider, n)) return deny({ code: 'RUN_LIMIT', detail: `${provider}: teto desta execução atingido (${opts.run.usedOf(provider)})`, retryAt: null })
  const ops = operationBudgets()
  const now = new Date()
  const rows = buildRows(provider, opts.operation, now, ops.ok ? ops.value : {})
  try {
    const r = await store.tryReserve(rows, n)
    if (!r.ok) {
      opts.run?.give(provider, n) // nada foi chamado: devolve só o slot da execução (o banco não contabilizou)
      const row = rows.find((x) => x.key === r.blockedKey) as RowMeta
      return deny(blockFor(provider, row, r.used, now))
    }
  } catch (e) {
    opts.run?.give(provider, n)
    return deny({ code: 'STORE_ERROR', detail: `falha ao reservar orçamento (bloqueado por segurança): ${(e as Error).message}`, retryAt: new Date(Date.now() + 60_000) })
  }
  metrics.callsReserved += n
  return { ok: true }
}

// Consumo, saldo e bloqueios — uma só fonte para endpoint, UI e logs.
export async function getUsage() {
  const now = new Date()
  const ops = operationBudgets()
  const out: Record<string, { ciclo: string | null; configurado: boolean; bloqueio: Block | null; janelas: Record<string, { usado: number; orcamento: number | null; efetivo: number | null; saldo: number | null; proximoReset: string | null }>; capGratuitoDocumentado: number | null; nota?: string; operacoes: Record<string, Record<string, { usado: number; efetivo: number }>> }> = {}
  for (const provider of PROVIDERS) {
    const b = budgetsOf(provider)
    const rows = buildRows(provider, undefined, now, {})
    const opRows = Object.keys(ops.ok ? ops.value : {}).filter((k) => k.startsWith(`${provider}:`)).flatMap((k) => buildRows(provider, k.split(':')[1], now, ops.ok ? ops.value : {}).filter((r) => r.operation))
    let used = new Map<string, number>()
    try { used = await store.read(keysOf([...rows, ...opRows])) } catch { /* mostra zero + bloqueio STORE_ERROR abaixo */ }
    const janelas: Record<string, { usado: number; orcamento: number | null; efetivo: number | null; saldo: number | null; proximoReset: string | null }> = {}
    for (const w of WINDOWS) {
      const limit = b[w] ?? null
      const row = rows.find((r) => r.window === w)
      const u = row ? usedOfRow(row, used) : 0
      const ef = limit == null ? null : effectiveLimit(provider, w, limit, now)
      janelas[w] = { usado: u, orcamento: limit, efetivo: ef, saldo: ef == null ? null : Math.max(0, ef - u), proximoReset: row ? row.spec.end.toISOString() : null }
    }
    const operacoes: Record<string, Record<string, { usado: number; efetivo: number }>> = {}
    for (const r of opRows) (operacoes[r.operation as string] ??= {})[r.window] = { usado: usedOfRow(r, used), efetivo: r.limit }
    const cyc = cycleOf(provider)
    out[provider] = {
      ciclo: cyc.ok ? `${cyc.value.mode}${cyc.value.anchorDay ? `:${cyc.value.anchorDay}` : ''} (${cyc.value.tz})` : null,
      configurado: configBlock(provider) == null,
      bloqueio: await currentBlock(provider),
      janelas,
      capGratuitoDocumentado: DOCUMENTED_FREE_CAP[provider]?.M ?? null,
      nota: DOCUMENTED_FREE_CAP[provider]?.note,
      operacoes,
    }
  }
  return { usage: out, metrics: { ...metrics }, limitacoes: LIMITATIONS, atualizadoEm: now.toISOString() }
}

// Só para testes.
export function _resetQuotaForTests(): void { store = prismaQuotaStore; Object.assign(metrics, { callsSavedByCache: 0, callsSavedByShortCircuit: 0, callsSkippedByQuota: 0, callsReserved: 0 }) }
