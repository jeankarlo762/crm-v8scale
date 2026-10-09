// Executa a investigação de UM lead, etapa por etapa, sem repetir o que já está vigente:
//   1) evidências e cache válidos → 2) URL do Google e links já disponíveis (HTTP grátis) → 3) Meta (bio do @ confirmado)
//   → 4) Tavily só para a incerteza que sobrar, da consulta mais discriminante para a menos.
// Cada etapa PAGA passa por api-guard (cache → dedupe → reserva atômica). Falta de orçamento/erro/auth nunca vira
// "sem site": a investigação fica com a etapa pendente e o lead vai para o andamento correto (aguardando cota/retry).
// Esta camada não toca no banco do lead: recebe as evidências e devolve o que mudou (testável com dependências falsas).
import { env } from '../config/env'
import type { GuardedResult } from './api-guard.service'
import type { QuotaRun } from './api-quota.service'
import { extractPageFacts, unevaluableFacts, FACTS_VERSION, type PageFacts } from './page-facts.service'
import { dependsOnHash, rowId, googleEvidenceRow, type EvidenceRow } from './lead-evidence.service'
import { resolveFromEvidence, type PlanStep, type Resolution, type ResolveLead } from './website-resolve.service'
import type { SearchResult } from './search-enrich.service'
import type { BusinessDiscoveryResult } from './instagram-business-discovery.service'
import { GOOGLE_DETAILS_COLLECTION_VERSION } from './website-types'
import type { PlaceDetails } from './places.service'
import type { InvestigationState, NextAction } from './website-types'

// A execução perdeu o claim (lease vencida e outro worker assumiu): para SEM novas chamadas externas e SEM gravar.
export class LeaseLostError extends Error { constructor() { super('lease perdida: execução interrompida') } }

export interface BlockedStep { step: string; code: string; retryAt: Date | null; detail: string; transient: boolean }

export interface InvestigationDeps {
  fetchFacts(url: string): Promise<PageFacts>
  fetchLinks(url: string): Promise<{ ok: boolean; links: string[]; instagram: string | null }>
  search(query: string, o: { run?: QuotaRun; refresh?: boolean }): Promise<GuardedResult<SearchResult[]> | { status: 'NOT_CONFIGURED' }>
  bio(handle: string, o: { run?: QuotaRun; refresh?: boolean }): Promise<GuardedResult<{ found: boolean; data: BusinessDiscoveryResult | null }> | { status: 'NOT_CONFIGURED' }>
  google(placeId: string, o: { run?: QuotaRun; refresh?: boolean }): Promise<GuardedResult<PlaceDetails> | { status: 'NOT_CONFIGURED' }>
  // Depois do Place Details aplicado ao lead (telefone/site/nota), devolve o lead ATUALIZADO: as consultas seguintes usam o telefone novo.
  refreshLead?(): Promise<ResolveLead>
  save(row: EvidenceRow): Promise<void>
  now(): Date
}

export interface RunContext {
  deps: InvestigationDeps
  dependsOn: string
  run?: QuotaRun
  forceAt?: Date | null
  tavilyConfigured: boolean
  metaConfigured: boolean
  googleConfigured?: boolean
  isActive?: () => boolean // false = o claim foi perdido: nenhuma nova chamada externa
  maxIterations?: number
  maxPageFetches?: number
}

export interface RunResult {
  resolution: Resolution
  rows: EvidenceRow[]
  blocked: BlockedStep[]
  stats: { tavilyCalls: number; metaCalls: number; googleCalls: number; pageFetches: number; cacheHits: number; iterations: number }
  exhausted: boolean
}

const SEARCH_KIND: Partial<Record<NextAction, 'NAME' | 'PHONE' | 'HANDLE' | 'ADDRESS' | 'INSTAGRAM'>> = {
  TAVILY_NAME: 'NAME', TAVILY_PHONE: 'PHONE', TAVILY_HANDLE: 'HANDLE', TAVILY_ADDRESS: 'ADDRESS', TAVILY_INSTAGRAM: 'INSTAGRAM',
}
const normQuery = (q: string) => q.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()

export async function runInvestigation(initialLead: ResolveLead, initialRows: EvidenceRow[], ctx: RunContext): Promise<RunResult> {
  let lead = initialLead
  let dependsOn = ctx.dependsOn
  const { deps } = ctx
  const rows = new Map(initialRows.map((r) => [rowId(r), r]))
  const blocked: BlockedStep[] = []
  const attempted: string[] = []
  const stats = { tavilyCalls: 0, metaCalls: 0, googleCalls: 0, pageFetches: 0, cacheHits: 0, iterations: 0 }
  const maxIter = ctx.maxIterations ?? 14
  const maxFetch = ctx.maxPageFetches ?? 8
  const resolve = (exhausted = false) => resolveFromEvidence(lead, [...rows.values()], {
    now: deps.now(), dependsOn, tavilyConfigured: ctx.tavilyConfigured, metaConfigured: ctx.metaConfigured, googleConfigured: ctx.googleConfigured,
    forceAt: ctx.forceAt, attempted, blocked: blocked.map((b) => ({ step: b.step, code: b.code })), exhausted,
  })
  const put = async (r: EvidenceRow) => { rows.set(rowId(r), r); await deps.save(r) }
  const block = (b: BlockedStep) => { blocked.push(b); attempted.push(b.step) }

  let res = resolve()
  let exhausted = false
  for (; stats.iterations < maxIter; stats.iterations++) {
    if (ctx.isActive && !ctx.isActive()) throw new LeaseLostError()
    const step: PlanStep | null = res.next
    if (!step) { exhausted = true; break }
    const refresh = !!ctx.forceAt
    if (step.action === 'PAGE_CHECK') {
      if (stats.pageFetches >= maxFetch) {
        // limite de páginas por rodada: NÃO é "sem evidência" — fica pendente e a fila volta logo, sem repetir o que já foi lido
        attempted.push(`PAGE_CHECK:${step.key}`)
        block({ step: 'PAGE_CHECK', code: 'RUN_LIMIT', retryAt: new Date(deps.now().getTime() + 30_000), detail: 'limite de páginas lidas por rodada', transient: true })
        res = resolve()
        continue
      }
      stats.pageFetches++
      attempted.push(`PAGE_CHECK:${step.key}`)
      let facts: PageFacts
      try { facts = await deps.fetchFacts(step.key) } catch (e) { facts = unevaluableFacts(step.key, 'ERROR'); console.error(`[investigation] falha ao ler ${step.key}:`, (e as Error).message) }
      await put({ source: 'WEBSITE', type: 'PAGE_FACTS', key: step.key, value: facts, outcome: facts.evaluable ? 'OK' : 'UNEVALUABLE', fromCache: false, collectedAt: deps.now(), dependsOn: '', version: FACTS_VERSION })
    } else if (step.action === 'LINK_RESOLVE') {
      attempted.push(`LINK_RESOLVE:${step.key}`)
      const l = await deps.fetchLinks(step.key).catch(() => ({ ok: false, links: [] as string[], instagram: null }))
      await put({ source: 'WEBSITE', type: 'LINK_PAGE', key: step.key, value: l, outcome: l.ok ? 'OK' : 'UNREADABLE', fromCache: false, collectedAt: deps.now(), dependsOn: '', version: FACTS_VERSION })
    } else if (step.action === 'GOOGLE_DETAILS') {
      const r = await deps.google(step.key, { run: ctx.run })
      if (r.status === 'NOT_CONFIGURED') { block({ step: 'GOOGLE_DETAILS', code: 'NOT_CONFIGURED', retryAt: null, detail: 'Google Places não configurado para Place Details', transient: false }) }
      else if (r.status === 'OK') {
        if (r.fromCache) stats.cacheHits++; else stats.googleCalls++
        // data REAL da resposta (de cache = quando foi coletada), versão da coleta e resultado do campo websiteUri
        // atualiza o lead com o que o Details trouxe (a fila grava no banco) e passa a investigar com o telefone novo
        const writeEvidence = put(googleEvidenceRow({ placeId: step.key, websiteUri: r.data.websiteUri, collection: r.data.collection ?? GOOGLE_DETAILS_COLLECTION_VERSION, collectedAt: r.collectedAt, fromCache: r.fromCache }))
        await writeEvidence
        if (deps.refreshLead) { lead = await deps.refreshLead(); dependsOn = dependsOnHash(lead) }
      } else block(blockOf('GOOGLE_DETAILS', r))
    } else if (step.action === 'META_BIO') {
      const r = await deps.bio(step.key, { run: ctx.run, refresh })
      if (r.status === 'NOT_CONFIGURED') { block({ step: 'META_BIO', code: 'NOT_CONFIGURED', retryAt: null, detail: 'Meta não configurada', transient: false }) }
      else if (r.status === 'OK') {
        if (r.fromCache) stats.cacheHits++; else stats.metaCalls++
        const d = r.data
        await put({ source: 'META', type: 'IG_BIO', key: step.key, value: { found: d.found, website: d.data?.website ?? null, biography: d.data?.biography?.slice(0, 400) ?? null, username: d.data?.username ?? null, followers: d.data?.followersCount ?? null, media: d.data?.mediaCount ?? null }, outcome: d.found ? 'OK' : 'NOT_FOUND', fromCache: r.fromCache, collectedAt: r.collectedAt, dependsOn, version: '' })
      } else block(blockOf('META_BIO', r))
    } else {
      const kind = SEARCH_KIND[step.action]
      if (!kind) { attempted.push(step.action); res = resolve(); continue }
      const r = await deps.search(step.key, { run: ctx.run, refresh })
      if (r.status === 'NOT_CONFIGURED') { block({ step: step.action, code: 'NOT_CONFIGURED', retryAt: null, detail: 'Tavily não configurada', transient: false }) }
      else if (r.status === 'OK') {
        if (r.fromCache) stats.cacheHits++; else stats.tavilyCalls++
        const results = r.data.slice(0, 10)
        await put({ source: 'TAVILY', type: 'SEARCH_RESULTS', key: normQuery(step.key), value: { kind, query: step.key, results }, outcome: results.length ? 'OK' : 'EMPTY', fromCache: r.fromCache, collectedAt: r.collectedAt, dependsOn, version: '' })
      } else block(blockOf(step.action, r))
    }
    res = resolve()
  }
  // Sem etapa a executar e sem bloqueio = nada mais a tentar. Com bloqueio, a etapa continua pendente (aguardando).
  const exh = exhausted && blocked.length === 0 || (exhausted && blocked.every((b) => !b.transient && b.code !== 'PROVIDER_PAUSED' && !b.code.startsWith('WINDOW_') && b.code !== 'OPERATION_LIMIT' && b.code !== 'RUN_LIMIT'))
  res = resolve(exh)
  return { resolution: res, rows: [...rows.values()], blocked, stats, exhausted: exh }
}

function blockOf(step: string, r: Exclude<GuardedResult<unknown>, { status: 'OK' }>): BlockedStep {
  switch (r.status) {
    case 'BLOCKED': return { step, code: r.block.code, retryAt: r.block.retryAt, detail: r.block.detail, transient: r.block.code === 'STORE_ERROR' || r.block.code === 'RUN_LIMIT' }
    case 'IN_FLIGHT': return { step, code: 'IN_FLIGHT', retryAt: new Date(Date.now() + 60_000), detail: 'mesma consulta em andamento em outra instância', transient: true }
    case 'RATE_LIMITED': return { step, code: 'RATE_LIMITED', retryAt: r.retryAfterMs ? new Date(Date.now() + r.retryAfterMs) : null, detail: r.error.message, transient: true }
    case 'PLAN_LIMIT': return { step, code: 'PLAN_LIMIT', retryAt: null, detail: r.error.message, transient: false }
    case 'AUTH': return { step, code: 'PROVIDER_PAUSED', retryAt: null, detail: r.error.message, transient: false }
    default: return { step, code: 'API_ERROR', retryAt: null, detail: r.error.message, transient: true }
  }
}

// ── Andamento a partir do resultado ─────────────────────────────────────────────────────────

export interface ProgressOutcome { state: InvestigationState; nextAction: NextAction | null; nextRunAt: Date | null; waitReason: string | null; attempts: number; lastError: string | null }

export function backoffMs(attempt: number, base = env.INVESTIGATION_BACKOFF_BASE_SEC, rand = Math.random): number {
  const ms = Math.min(6 * 3600_000, base * 1000 * 2 ** Math.max(0, attempt - 1))
  return Math.round(ms * (0.8 + rand() * 0.4))
}

export function progressFrom(run: RunResult, prevAttempts: number, now: Date, maxAttempts = env.INVESTIGATION_MAX_ATTEMPTS, rand = Math.random): ProgressOutcome {
  const d = run.resolution.decision
  const base = { attempts: prevAttempts, lastError: null as string | null }
  if (d.outcome === 'FINAL') return { ...base, state: 'DONE', nextAction: null, nextRunAt: null, waitReason: null, attempts: 0 }
  const next = run.resolution.next?.action ?? run.blocked[0]?.step as NextAction | undefined ?? null
  if (run.blocked.length === 0) {
    // sem bloqueio: ou esgotou (revisão manual) ou o laço parou no limite de iterações (continua logo)
    if (d.outcome === 'NEEDS_REVIEW' || run.exhausted) return { ...base, state: 'MANUAL_REVIEW', nextAction: 'MANUAL_REVIEW', nextRunAt: null, waitReason: d.primaryReason, attempts: 0 }
    return { ...base, state: 'PENDING', nextAction: next, nextRunAt: new Date(now.getTime() + 30_000), waitReason: 'CONTINUATION' }
  }
  const quota = run.blocked.filter((b) => b.code.startsWith('WINDOW_') || b.code === 'OPERATION_LIMIT' || b.code === 'PLAN_LIMIT' || b.code === 'RUN_LIMIT')
  const cfg = run.blocked.filter((b) => b.code === 'NOT_CONFIGURED' || b.code === 'ABOVE_DOCUMENTED_CAP' || b.code === 'INVALID_CONFIG')
  const paused = run.blocked.filter((b) => b.code === 'PROVIDER_PAUSED')
  const retry = run.blocked.filter((b) => b.code === 'RATE_LIMITED' || b.code === 'API_ERROR' || b.code === 'IN_FLIGHT' || b.code === 'STORE_ERROR')
  const detail = run.blocked.map((b) => `${b.step}:${b.code}`).join(', ')
  if (retry.length) {
    const attempts = prevAttempts + 1
    if (attempts >= maxAttempts) return { state: 'MANUAL_REVIEW', nextAction: 'MANUAL_REVIEW', nextRunAt: null, waitReason: `RETRIES_EXHAUSTED (${detail})`, attempts, lastError: retry[0].detail.slice(0, 300) }
    const hint = retry.map((b) => b.retryAt?.getTime() ?? 0).reduce((a, b) => Math.max(a, b), 0)
    const at = Math.max(now.getTime() + backoffMs(attempts, undefined, rand), hint)
    return { state: 'WAITING_RETRY', nextAction: next, nextRunAt: new Date(at), waitReason: detail, attempts, lastError: retry[0].detail.slice(0, 300) }
  }
  if (paused.length) return { state: 'WAITING_RETRY', nextAction: next, nextRunAt: new Date(now.getTime() + 3600_000), waitReason: `PROVIDER_PAUSED: ${paused[0].detail.slice(0, 120)}`, attempts: prevAttempts, lastError: null }
  if (quota.length) {
    const at = quota.map((b) => b.retryAt?.getTime() ?? now.getTime() + 3600_000).reduce((a, b) => Math.min(a, b))
    return { state: 'WAITING_QUOTA', nextAction: next, nextRunAt: new Date(Math.max(at, now.getTime() + 60_000)), waitReason: quota[0].detail.slice(0, 200), attempts: prevAttempts, lastError: null }
  }
  if (cfg.length) return { state: 'WAITING_QUOTA', nextAction: next, nextRunAt: new Date(now.getTime() + 3600_000), waitReason: `${cfg[0].code}: ${cfg[0].detail.slice(0, 160)}`, attempts: prevAttempts, lastError: null }
  return { state: 'WAITING_RETRY', nextAction: next, nextRunAt: new Date(now.getTime() + 300_000), waitReason: detail, attempts: prevAttempts, lastError: null }
}

// Fatos a partir do health check (reaproveita o HTML do health check: uma só requisição por página).
export function factsFromHealth(url: string, h: { status: string; finalUrl: string; html: string; httpStatus?: number | null; blocked?: boolean }): PageFacts {
  return extractPageFacts({ url, finalUrl: h.finalUrl, html: h.html, httpStatus: h.httpStatus ?? (h.html ? 200 : null), blocked: h.blocked, health: h.status })
}
