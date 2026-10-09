// Fila PERSISTENTE da investigação de site (no próprio Prospect, Postgres): estado de andamento, próxima ação, tentativas,
// próxima execução e motivo da espera sobrevivem a restart/deploy e a várias instâncias.
//  - claim com lease: `FOR UPDATE SKIP LOCKED` — duas instâncias nunca pegam o mesmo lead; lease vencida é recuperada;
//  - cada CLAIM tem um token único (INSTANCE_ID sozinho não identifica uma execução): a lease é renovada enquanto a execução
//    roda, e renovar, gravar evidência e fechar a execução só valem para o token vigente — um worker antigo, cuja lease venceu
//    e foi reclamada, não grava nada nem faz novas chamadas externas (LeaseLostError). Nenhuma transação fica aberta durante rede;
//  - retoma sozinha quando há orçamento (WAITING_QUOTA acorda no fim da janela) e sem refazer etapas vigentes (evidências);
//  - erro técnico: backoff exponencial com teto de tentativas (depois, revisão manual — nunca "sem site");
//  - auth inválida pausa a integração (provider-state) e fica visível; não há retry infinito;
//  - `force` (reverificar) refaz etapas VENCIDAS, mas toda chamada externa continua passando pela reserva de orçamento.
import { randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '../config/database'
import { env } from '../config/env'
import { classifyPresencaDigital, fetchPageHrefs } from './site-classifier.service'
import { isSearchConfigured, searchTavily } from './search-enrich.service'
import { getBusinessDiscoveryGuarded, isBusinessDiscoveryConfigured } from './instagram-business-discovery.service'
import { checkSiteHealth } from './site-health.service'
import { parsePhone } from './phone.service'
import { computeLeadScore, investigationPriority } from './lead-score.service'
import { syncOwnerGroups, ownerGroupSize } from './owner-group.service'
import { QuotaRun } from './api-quota.service'
import { rejectInstagramHandle } from './found-site-rules.service'
import { dependsOnHash, loadEvidence, purgeInvalidEvidence, rowState, saveEvidence, type EvidenceRow } from './lead-evidence.service'
import { factsFromHealth, progressFrom, runInvestigation, LeaseLostError, type InvestigationDeps } from './investigation.service'
import { fetchPlaceDetails, type PlaceDetails } from './places.service'
import { phoneFields } from './phone.service'
import { normUrl, type ResolveLead } from './website-resolve.service'
import { FACTS_VERSION } from './page-facts.service'
import { classifyUrl, isCandidateSiteKind } from './url-classify.service'
import { CLASSIFIER_VERSION, type InvestigationState } from './website-types'
import type { AddressComponent } from './places.service'

export const leadPriority = investigationPriority

export const INSTANCE_ID = `${process.pid}-${randomUUID().slice(0, 8)}`
const CACHE_DIAS = 30 // saúde do site do Google (classificação legada): HTTP é grátis, mas não refaz a cada ciclo

// ── Enfileirar ───────────────────────────────────────────────────────────────────────────────

// `force` = reverificar: refaz etapas já vencidas. NÃO ignora orçamento: cada chamada externa reserva de qualquer jeito.
export async function enqueueSiteClassify(leadId: string, force = false, priority?: number): Promise<void> {
  const now = new Date()
  await prisma.prospect.updateMany({
    where: { id: leadId, OR: [{ investigationState: null }, { investigationState: { not: 'PROCESSING' } }] },
    data: { investigationState: 'PENDING', investigationNextRunAt: now, investigationAttempts: 0, investigationWaitReason: null, investigationLastError: null, investigationLockedBy: null, investigationLockedUntil: null, investigationLockToken: null, ...(priority != null ? { investigationPriority: priority } : {}), ...(force ? { investigationForceAt: now } : {}) },
  })
  if (force) await prisma.prospect.updateMany({ where: { id: leadId, investigationState: 'PROCESSING' }, data: { investigationForceAt: now } }) // aplicado ao fim da rodada em curso
  kick()
}

export async function enqueueManySiteClassify(leadIds: string[], priorities?: Map<string, number>): Promise<void> {
  const now = new Date()
  for (const id of leadIds) {
    const p = priorities?.get(id)
    await prisma.prospect.updateMany({
      where: { id, OR: [{ investigationState: null }, { investigationState: { not: 'PROCESSING' } }] },
      data: { investigationState: 'PENDING', investigationNextRunAt: now, investigationAttempts: 0, investigationWaitReason: null, ...(p != null ? { investigationPriority: p } : {}) },
    })
  }
  kick()
}

// ── Claim / lease ────────────────────────────────────────────────────────────────────────────

// Lease vencida = o worker morreu no meio: volta como WAITING_RETRY (conta tentativa) ou, esgotadas, vai pra revisão manual.
export async function recoverExpiredLeases(): Promise<number> {
  const n = await prisma.$executeRaw`
    UPDATE "Prospect" SET
      "investigationState" = CASE WHEN "investigationAttempts" + 1 >= ${env.INVESTIGATION_MAX_ATTEMPTS} THEN 'MANUAL_REVIEW' ELSE 'WAITING_RETRY' END,
      "investigationAttempts" = "investigationAttempts" + 1,
      "investigationWaitReason" = 'LEASE_EXPIRED: worker interrompido, retomando',
      "investigationNextRunAt" = CASE WHEN "investigationAttempts" + 1 >= ${env.INVESTIGATION_MAX_ATTEMPTS} THEN NULL ELSE (now() AT TIME ZONE 'UTC') END,
      "investigationLockedBy" = NULL, "investigationLockedUntil" = NULL, "investigationLockToken" = NULL, "updatedAt" = (now() AT TIME ZONE 'UTC')
    WHERE "investigationState" = 'PROCESSING' AND "investigationLockedUntil" < (now() AT TIME ZONE 'UTC')`
  if (n > 0) console.warn(`[investigation] ${n} lead(s) com lease vencida recuperado(s)`)
  return Number(n)
}

export interface Claimed { id: string; attempts: number; forceAt: Date | null; token: string }

export async function claimBatch(limit: number, worker = INSTANCE_ID): Promise<Claimed[]> {
  if (limit <= 0) return []
  const rows = await prisma.$queryRaw<{ id: string; investigationAttempts: number; investigationForceAt: Date | null; investigationLockToken: string }[]>`
    UPDATE "Prospect" SET "investigationState" = 'PROCESSING', "investigationLockedBy" = ${worker}, "investigationLockToken" = gen_random_uuid()::text,
      "investigationLockedUntil" = (now() AT TIME ZONE 'UTC') + (${env.INVESTIGATION_LEASE_MS} * interval '1 millisecond'), "updatedAt" = (now() AT TIME ZONE 'UTC')
    WHERE "id" IN (
      SELECT "id" FROM "Prospect"
      WHERE "investigationState" IN ('PENDING','WAITING_QUOTA','WAITING_RETRY') AND "investigationNextRunAt" IS NOT NULL AND "investigationNextRunAt" <= (now() AT TIME ZONE 'UTC')
      ORDER BY "investigationPriority" DESC, "investigationNextRunAt" ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED)
    RETURNING "id", "investigationAttempts", "investigationForceAt", "investigationLockToken"`
  return rows.map((r) => ({ id: r.id, attempts: r.investigationAttempts, forceAt: r.investigationForceAt, token: r.investigationLockToken }))
}

// Renova a lease SÓ para o token vigente e ainda não vencido (lease vencida = perdida, mesmo que ninguém tenha reclamado ainda).
export async function renewLease(id: string, token: string): Promise<boolean> {
  const n = await prisma.$executeRaw`
    UPDATE "Prospect" SET "investigationLockedUntil" = (now() AT TIME ZONE 'UTC') + (${env.INVESTIGATION_LEASE_MS} * interval '1 millisecond')
    WHERE "id" = ${id} AND "investigationLockToken" = ${token} AND "investigationState" = 'PROCESSING' AND "investigationLockedUntil" > (now() AT TIME ZONE 'UTC')`
  return Number(n) > 0
}

// Heartbeat enquanto a execução roda. isActive() vira false ao perder o claim — ou quando não conseguimos renovar até o fim da
// lease conhecida (conservador: sem confirmação de posse, não faz nova chamada externa).
export function startLeaseHeartbeat(c: Pick<Claimed, 'id' | 'token'>, leaseMs = env.INVESTIGATION_LEASE_MS, renew: (id: string, token: string) => Promise<boolean> = renewLease) {
  let lost = false
  let validUntil = Date.now() + leaseMs
  const timer = setInterval(() => {
    renew(c.id, c.token).then((ok) => { if (ok) validUntil = Date.now() + leaseMs; else lost = true }).catch((e) => console.error(`[investigation] renovação de lease falhou (${c.id}):`, (e as Error).message))
  }, Math.max(1, Math.floor(leaseMs / 3)))
  timer.unref?.()
  return { isActive: () => !lost && Date.now() < validUntil, stop: () => clearInterval(timer) }
}

// Grava evidência SÓ se o token ainda é o dono do claim. A checagem trava a linha do lead (FOR SHARE) na mesma transação curta
// do upsert — recuperação/novo claim esperam o commit; a rede nunca acontece dentro desta transação.
export async function saveEvidenceOwned(prospectId: string, token: string, r: EvidenceRow): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const own = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "Prospect" WHERE "id" = ${prospectId} AND "investigationLockToken" = ${token} AND "investigationState" = 'PROCESSING' AND "investigationLockedUntil" > (now() AT TIME ZONE 'UTC') FOR SHARE`
    if (own.length === 0) throw new LeaseLostError()
    const data = { value: r.value as Prisma.InputJsonValue, outcome: r.outcome, fromCache: r.fromCache, collectedAt: r.collectedAt, dependsOn: r.dependsOn, version: r.version }
    await tx.leadEvidence.upsert({
      where: { prospectId_source_type_key: { prospectId, source: r.source, type: r.type, key: r.key } },
      create: { prospectId, source: r.source, type: r.type, key: r.key, ...data },
      update: data,
    })
  })
}

// Cache de consultas: apaga o que venceu há mais de 7 dias (os TTLs reais são horas/dias; o resto é lixo).
export async function purgeExpiredCache(): Promise<number> {
  const r = await prisma.apiCache.deleteMany({ where: { expiresAt: { lt: new Date(Date.now() - 7 * 86_400_000) } } })
  return r.count
}

// Integração retomada (credencial corrigida): acorda quem estava esperando por ela.
export async function wakeWaitingFor(provider: string): Promise<number> {
  const r = await prisma.prospect.updateMany({
    where: { investigationState: { in: ['WAITING_RETRY', 'WAITING_QUOTA'] }, investigationWaitReason: { contains: provider === 'GOOGLE_PLACES' ? 'GOOGLE' : provider } },
    data: { investigationNextRunAt: new Date() },
  })
  kick()
  return r.count
}

// ── Dependências reais ───────────────────────────────────────────────────────────────────────

// Pontos de injeção (testes): rede/HTTP/APIs. Em produção valem os padrões.
export interface QueueDeps {
  makeDeps: (prospectId: string) => InvestigationDeps
  classify: typeof classifyPresencaDigital
  tavilyConfigured: () => boolean
  metaConfigured: () => boolean
  googleConfigured: () => boolean
}
const defaultQueueDeps: QueueDeps = { makeDeps: (id) => realDeps(id), classify: classifyPresencaDigital, tavilyConfigured: isSearchConfigured, metaConfigured: isBusinessDiscoveryConfigured, googleConfigured: () => env.PLACES_MOCK !== 'true' && !!env.GOOGLE_PLACES_API_KEY }
let queueDeps: QueueDeps = defaultQueueDeps
export function _setQueueDepsForTests(d: Partial<QueueDeps> | null): void { queueDeps = d ? { ...defaultQueueDeps, ...d } : defaultQueueDeps }

function realDeps(prospectId: string): InvestigationDeps {
  return {
    fetchFacts: async (url) => { const h = await checkSiteHealth(url); return factsFromHealth(url, h) },
    fetchLinks: (url) => fetchPageHrefs(url),
    search: (q, o) => searchTavily(q, o),
    bio: async (h, o) => (isBusinessDiscoveryConfigured() ? getBusinessDiscoveryGuarded(h, o) : { status: 'NOT_CONFIGURED' as const }),
    google: (placeId, o) => fetchPlaceDetails(placeId, o),
    save: (row) => saveEvidence(prospectId, row), // processLead substitui por saveEvidenceOwned (token do claim)
    now: () => new Date(),
  }
}

type ProspectRow = NonNullable<Awaited<ReturnType<typeof prisma.prospect.findUnique>>>

// Outro lead usa o MESMO @ confirmado? Então o perfil é da marca/compartilhado e não prova uma unidade específica.
export async function instagramShared(l: Pick<ProspectRow, 'id' | 'instagramHandle' | 'instagramVerificar'>): Promise<boolean> {
  if (!l.instagramHandle) return false
  return (await prisma.prospect.count({ where: { id: { not: l.id }, instagramHandle: { equals: l.instagramHandle, mode: 'insensitive' } } })) > 0
}

export function toResolveLead(l: ProspectRow, ownerSize: number, igShared = false): ResolveLead {
  return {
    instagramShared: igShared,
    arenaName: l.arenaName, city: l.city, state: l.state, address: l.address, addressComponents: (l.addressComponents as AddressComponent[] | null) ?? null,
    phoneE164: l.phoneE164, whatsapp: l.whatsapp, placeId: l.placeId, website: l.website,
    instagramHandle: l.instagramHandle, instagramVerificar: l.instagramVerificar, instagramManual: l.instagramManual, siteManual: l.siteManual,
    foundWebsite: l.foundWebsite, foundWebsiteSource: l.foundWebsiteSource, confirmedWebsite: l.confirmedWebsite,
    websiteConfirmation: (l.websiteConfirmation as { url?: string | null } | null) ?? null, ownerGroupSize: ownerSize,
  }
}

function isFresh(d: Date | null): boolean { return !!d && (Date.now() - d.getTime()) / 86_400_000 < CACHE_DIAS }

// ── Processar um lead ────────────────────────────────────────────────────────────────────────

export async function processLead(c: Claimed, run: QuotaRun): Promise<void> {
  const hb = startLeaseHeartbeat(c)
  try {
    await processLeadOwned(c, run, hb.isActive)
  } catch (e) {
    if (e instanceof LeaseLostError) { console.warn(`[investigation] lead ${c.id}: claim perdido, execução abandonada sem gravar`); return }
    throw e
  } finally { hb.stop() }
}

async function processLeadOwned(c: Claimed, run: QuotaRun, isActive: () => boolean): Promise<void> {
  const startedAt = Date.now()
  let lead = await prisma.prospect.findUnique({ where: { id: c.id } })
  if (!lead) return
  const owned = (row: EvidenceRow) => saveEvidenceOwned(c.id, c.token, row)

  // Backfill do telefone em E.164 pra leads antigos/importados.
  if (!lead.phoneE164 && lead.whatsapp) {
    const parsed = parsePhone([lead.whatsapp])
    if (parsed) {
      lead = await prisma.prospect.update({ where: { id: c.id }, data: { phoneE164: parsed.e164, phoneCountry: parsed.country, phoneMobile: parsed.isMobile } })
      await syncOwnerGroups([parsed.e164])
      lead = (await prisma.prospect.findUnique({ where: { id: c.id } })) ?? lead
    }
  }

  const dependsOn = dependsOnHash(lead)
  let rows = await loadEvidence(c.id)
  const purged = await purgeInvalidEvidence(c.id, rows, dependsOn)
  if (purged) rows = await loadEvidence(c.id)

  // Lead com placeId e SEM Place Details vigente ainda não tem telefone/website conhecidos: a classificação legada (statusSite,
  // "sem_nada") seria uma conclusão falsa de "sem site". Ela roda quando o Details chegar (applyDetailsAndClassify) ou, para
  // lead sem placeId, agora.
  const hasDetails = rows.some((r) => r.source === 'GOOGLE' && r.type === 'PLACE_FIELDS' && rowState(r, dependsOn) === 'FRESH')
  const classifyNow = async () => {
    if (!isActive()) throw new LeaseLostError()
    const cur = (await prisma.prospect.findUnique({ where: { id: c.id } })) ?? lead!
    const r = await queueDeps.classify(cur.website, cur.arenaName, cur.whatsapp)
    const upd = await prisma.prospect.updateMany({
      where: { id: c.id, investigationLockToken: c.token },
      data: {
        statusSite: r.status, siteUrl: r.siteUrl, linksEncontrados: r.linksEncontrados as object, fonte: r.fonte, siteStatus: r.siteStatus, siteCheckReason: r.siteCheckReason ?? null,
        instagram: r.linksEncontrados.instagram ?? cur.instagram,
        ...(r.instagramHandle && !cur.instagramManual && !cur.instagramHandle ? { instagramHandle: r.instagramHandle, instagramVerificar: false } : {}),
        verificadoEm: new Date(),
      },
    })
    if (upd.count === 0) throw new LeaseLostError()
    const after = (await prisma.prospect.findUnique({ where: { id: c.id } })) ?? cur
    const key = normUrl(after.website)
    if (r.pageFacts && key && isCandidateSiteKind(classifyUrl(after.website).kind)) {
      await owned({ source: 'WEBSITE', type: 'PAGE_FACTS', key, value: r.pageFacts, outcome: r.pageFacts.evaluable ? 'OK' : 'UNEVALUABLE', fromCache: false, collectedAt: new Date(), dependsOn: '', version: FACTS_VERSION })
    }
    return after
  }
  if ((c.forceAt || !isFresh(lead.verificadoEm)) && (!lead.placeId || hasDetails)) {
    lead = await classifyNow()
    rows = await loadEvidence(c.id)
  }

  const ownerSize = await ownerGroupSize(lead)
  const igShared = await instagramShared(lead)
  const base = queueDeps.makeDeps(c.id)
  const deps: InvestigationDeps = {
    ...base,
    save: owned,
    // Place Details aplicado ao lead (só se o claim ainda é nosso) → classificação legada + lead atualizado para as próximas etapas
    google: async (placeId, o) => {
      const r = await base.google(placeId, o)
      if (r.status === 'OK') { await applyPlaceDetailsOwned(c, r.data); await classifyNow() }
      return r
    },
    refreshLead: async () => { const l = await prisma.prospect.findUniqueOrThrow({ where: { id: c.id } }); return toResolveLead(l, await ownerGroupSize(l), igShared) },
  }
  const out = await runInvestigation(toResolveLead(lead, ownerSize, igShared), rows, {
    deps, dependsOn, run, forceAt: c.forceAt, tavilyConfigured: queueDeps.tavilyConfigured(), metaConfigured: queueDeps.metaConfigured(), googleConfigured: queueDeps.googleConfigured(), isActive,
  })
  const latest = (await prisma.prospect.findUnique({ where: { id: c.id } })) ?? lead
  await persistRun(latest, out, c, purged > 0, await ownerGroupSize(latest), startedAt)
}

// Aplica o que o Place Details trouxe (telefone, website, nota, avaliações) ao lead — condicionado ao token do claim.
export async function applyPlaceDetailsOwned(c: Pick<Claimed, 'id' | 'token'>, d: PlaceDetails): Promise<void> {
  const hasPhone = !!(d.internationalPhone || d.nationalPhone)
  const phone = hasPhone ? phoneFields(d.internationalPhone, d.nationalPhone) : null
  const upd = await prisma.prospect.updateMany({
    where: { id: c.id, investigationLockToken: c.token },
    data: {
      updatedAt: new Date(), // garante um UPDATE mesmo sem campos (o count é a prova de posse do claim)
      ...(phone ?? {}),
      ...(d.websiteUri ? { website: d.websiteUri, verificadoEm: null } : {}), // site novo/diferente: reclassifica
      ...(d.rating != null ? { avaliacao: d.rating } : {}),
      ...(d.userRatingCount != null ? { numAvaliacoes: d.userRatingCount } : {}),
    },
  })
  if (upd.count === 0) throw new LeaseLostError()
  if (phone?.phoneE164) await syncOwnerGroups([phone.phoneE164])
}

type RunOut = Awaited<ReturnType<typeof runInvestigation>>

async function persistRun(lead: ProspectRow, out: RunOut, c: Claimed, inputsChanged: boolean, ownerSize: number, startedAt: number): Promise<void> {
  const now = new Date()
  const { resolution: res } = out
  const d = res.decision
  const prog = progressFrom(out, c.attempts, now)
  const hadDecision = lead.websiteStatus != null
  // INCOMPLETA não derruba decisão anterior (cota/erro não é evidência) — mas a decisão antiga fica só como HISTÓRICO:
  // websiteOutcome/websiteCoverage descrevem a investigação ATUAL e a elegibilidade comercial olha para eles (ver
  // no-website-eligibility). Só grava a decisão nova se o lead ainda não tinha decisão ou se as entradas mudaram.
  const writeDecision = d.outcome !== 'INCOMPLETE' || !hadDecision || inputsChanged
  const prev = (lead.websiteConfirmation as ConfirmationRecord | null) ?? legacyConfirmation(lead.confirmedWebsite)
  const data: Record<string, unknown> = {
    websiteOutcome: d.outcome, websiteValidUntil: d.validUntil ? new Date(d.validUntil) : null,
    websiteCoverage: coverageJson(res, out, now) as unknown as Prisma.InputJsonValue,
    websiteConfirmation: nextConfirmation(prev, d, now) as unknown as Prisma.InputJsonValue,
  }

  if (writeDecision) {
    Object.assign(data, {
      websiteStatus: d.status, websiteConfidence: d.confidence, websiteReason: d.primaryReason, websiteDecidedAt: now, classifierVersion: CLASSIFIER_VERSION,
      websiteEvidence: [...d.evidence, ...d.reasons.map((r) => ({ source: 'DECISION', type: 'REASON', value: r, confidence: 0 }))] as unknown as Prisma.InputJsonValue,
      ...(d.confirmation.valid && d.confirmedWebsite ? { confirmedWebsite: d.confirmedWebsite } : {}), // confirmedWebsite = histórico; a validade fica em websiteConfirmation
    })
    if (!lead.instagramManual && res.derived.instagramHandle && res.derived.instagramHandle !== lead.instagramHandle && !rejectInstagramHandle(res.derived.instagramHandle, { arenaName: lead.arenaName, city: lead.city, state: lead.state })) {
      Object.assign(data, { instagramHandle: res.derived.instagramHandle, instagramVerificar: res.derived.instagramVerificar })
    }
    if (!lead.siteManual && d.outcome !== 'INCOMPLETE') { // incompleta: ainda há candidatos por ler, não apaga o achado anterior
      const f = res.derived
      Object.assign(data, { foundWebsite: f.foundWebsite, foundWebsiteVerificar: f.foundWebsiteVerificar, foundSiteStatus: f.foundSiteStatus, foundWebsiteSource: f.foundWebsiteSource, ...(f.foundWebsite ? {} : { foundSiteCheckReason: null }) })
    }
    if (out.stats.tavilyCalls + out.stats.cacheHits > 0 && !out.blocked.some((b) => b.step.startsWith('TAVILY'))) Object.assign(data, { enrichedAt: now, enrichError: null })
  }
  const merged = { ...lead, ...data } as ProspectRow
  const leadScore = computeLeadScore({ ...merged, ownerGroupSize: ownerSize })

  // Reverificação pedida durante a rodada: volta pra fila em vez de concluir.
  const fresh = await prisma.prospect.findUnique({ where: { id: lead.id }, select: { investigationForceAt: true } })
  const forcedMeanwhile = !!fresh?.investigationForceAt && (!c.forceAt || fresh.investigationForceAt > c.forceAt)
  const state: InvestigationState = forcedMeanwhile ? 'PENDING' : prog.state
  // Fechamento condicionado ao TOKEN vigente: worker antigo (lease vencida e reclamada) não escreve nem libera o claim do novo.
  const closed = await prisma.prospect.updateMany({
    where: { id: lead.id, investigationLockToken: c.token },
    data: {
      ...data, leadScore,
      investigationState: state, investigationNextAction: prog.nextAction, investigationAttempts: prog.attempts, investigationNextRunAt: forcedMeanwhile ? now : prog.nextRunAt,
      investigationWaitReason: prog.waitReason, investigationLastError: prog.lastError, investigationLockedBy: null, investigationLockedUntil: null, investigationLockToken: null,
      investigationPriority: investigationPriority(lead), ...(prog.state === 'DONE' || prog.state === 'MANUAL_REVIEW' ? { investigationForceAt: forcedMeanwhile ? fresh?.investigationForceAt : null } : {}),
    },
  })
  if (closed.count === 0) { console.warn(`[investigation] lead ${lead.id}: claim perdido antes de fechar a execução; nada foi gravado`); return }
  console.log(JSON.stringify({
    msg: 'website-investigation', prospectId: lead.id, placeId: lead.placeId, status: d.status, outcome: d.outcome, reason: d.primaryReason, confidence: d.confidence, state,
    nextAction: prog.nextAction, tavilyCalls: out.stats.tavilyCalls, metaCalls: out.stats.metaCalls, googleCalls: out.stats.googleCalls, cacheHits: out.stats.cacheHits, pageFetches: out.stats.pageFetches,
    blocked: out.blocked.map((b) => `${b.step}:${b.code}`), wrote: writeDecision, ms: Date.now() - startedAt,
  }))
}

// ── Confirmação histórica: preserva o passado, mas só vale o que foi confirmado AGORA ───────────

// Quatro datas, quatro significados (nunca confundir):
//   collectedAt        quando a evidência foi REALMENTE coletada (fetch da página; de cache = a data original)
//   revalidatedAt      última revalidação EFETIVA: só avança quando chega evidência mais nova — nunca por reutilizar cache,
//                      rodar migração ou recalcular evidências antigas sem rede
//   manualConfirmedAt  confirmação manual (site informado/confirmado por pessoa)
//   recomputedAt       quando a DECISÃO foi recalculada (não prova nada sobre o mundo externo)
export interface ConfirmationRecord {
  url: string | null; valid: boolean; source: string | null; confirmedAt: string | null; revalidatedAt: string | null
  collectedAt?: string | null; manualConfirmedAt?: string | null; recomputedAt?: string | null
  invalidatedAt?: string | null; invalidReason?: string | null; evidence: unknown[]; legacy?: boolean
  history: { url: string | null; source: string | null; confirmedAt: string | null; invalidatedAt: string | null; reason: string | null }[]
}

export function legacyConfirmation(url: string | null | undefined): ConfirmationRecord | null {
  return url ? { url, valid: false, source: 'LEGACY', confirmedAt: null, revalidatedAt: null, evidence: [], legacy: true, history: [] } : null
}

const latestIso = (a: string | null | undefined, b: string | null | undefined): string | null => (a && b ? (Date.parse(a) >= Date.parse(b) ? a : b) : a ?? b ?? null)

export function nextConfirmation(prev: ConfirmationRecord | null, d: { confirmation: { valid: boolean; url: string | null; source: string | null; at: string | null; evidence: unknown[] }; primaryReason: string }, now: Date): ConfirmationRecord {
  const iso = now.toISOString()
  const c = d.confirmation
  const history = [...(prev?.history ?? [])]
  if (c.valid && c.url) {
    const manual = c.source === 'MANUAL'
    if (prev?.url && prev.url === c.url && prev.valid) {
      return { ...prev, collectedAt: latestIso(prev.collectedAt, c.at), revalidatedAt: manual ? prev.revalidatedAt : latestIso(prev.revalidatedAt, c.at), manualConfirmedAt: manual ? prev.manualConfirmedAt ?? iso : prev.manualConfirmedAt ?? null, recomputedAt: iso, evidence: c.evidence, invalidatedAt: null, invalidReason: null }
    }
    if (prev?.url && prev.url !== c.url) history.push({ url: prev.url, source: prev.source, confirmedAt: prev.confirmedAt, invalidatedAt: prev.invalidatedAt ?? iso, reason: prev.valid ? 'REPLACED' : prev.invalidReason ?? 'NOT_REVALIDATED' })
    // confirmação nova: a data é a da EVIDÊNCIA (coleta real); manual não tem coleta — registra o momento da confirmação manual
    return { url: c.url, valid: true, source: c.source, confirmedAt: manual ? iso : c.at ?? iso, revalidatedAt: manual ? null : c.at ?? null, collectedAt: manual ? null : c.at, manualConfirmedAt: manual ? iso : null, recomputedAt: iso, evidence: c.evidence, history }
  }
  // sem confirmação agora: mantém o registro anterior como INVÁLIDO (histórico preservado), com o motivo
  if (!prev) return { url: null, valid: false, source: null, confirmedAt: null, revalidatedAt: null, recomputedAt: iso, evidence: [], history }
  return { ...prev, valid: false, recomputedAt: iso, invalidatedAt: prev.valid ? iso : prev.invalidatedAt ?? iso, invalidReason: d.primaryReason, history }
}

export function coverageJson(res: RunOut['resolution'], out: { exhausted: boolean; blocked: RunOut['blocked']; stats: RunOut['stats'] }, now: Date) {
  const c = res.coverage
  return {
    sources: c.sources, required: c.required, done: c.done, failed: c.failed, queries: c.queries, staleNegative: c.staleNegative, exhausted: out.exhausted,
    pending: res.decision.pending, remaining: res.plan.filter((p) => !p.done).map((p) => ({ action: p.action, key: p.key, paid: p.paid })),
    blocked: out.blocked.map((b) => ({ step: b.step, code: b.code, detail: b.detail.slice(0, 160) })),
    candidates: res.candidates.map((x) => ({ url: x.finalUrl ?? x.url, source: x.source, linkage: x.linkage, health: x.health, at: x.collectedAt ?? null, fromCache: !!x.fromCache })),
    staleReasons: res.staleReasons, calibrated: false, at: now.toISOString(),
    validUntil: c.validUntil ?? null, notes: c.notes ?? [],
    calls: { tavily: out.stats.tavilyCalls, meta: out.stats.metaCalls, google: out.stats.googleCalls, cacheHits: out.stats.cacheHits, pageFetches: out.stats.pageFetches },
  }
}

// ── Worker ───────────────────────────────────────────────────────────────────────────────────

let timer: NodeJS.Timeout | null = null
let running = 0
let ticking = false
let lastPurge = 0
let stopped = true

async function tick(): Promise<void> {
  if (stopped || ticking) return
  ticking = true
  try {
    await recoverExpiredLeases().catch((e) => console.error('[investigation] recuperação de lease falhou:', (e as Error).message))
    if (Date.now() - lastPurge > 3600_000) { lastPurge = Date.now(); await purgeExpiredCache().catch(() => {}) }
    const claimed = await claimBatch(env.INVESTIGATION_CONCURRENCY - running)
    if (claimed.length === 0) return
    const run = new QuotaRun(`tick-${Date.now()}`) // teto por execução compartilhado pelo lote
    for (const c of claimed) {
      running++
      processLead(c, run)
        .catch(async (err) => {
          console.error(`[investigation] falha no lead ${c.id}:`, err)
          const attempts = c.attempts + 1
          const exhausted = attempts >= env.INVESTIGATION_MAX_ATTEMPTS
          await prisma.prospect.updateMany({
            where: { id: c.id, investigationLockToken: c.token },
            data: { investigationState: exhausted ? 'MANUAL_REVIEW' : 'WAITING_RETRY', investigationAttempts: attempts, investigationNextRunAt: exhausted ? null : new Date(Date.now() + 60_000 * 2 ** (attempts - 1)), investigationWaitReason: exhausted ? 'RETRIES_EXHAUSTED' : 'UNEXPECTED_ERROR', investigationLastError: (err instanceof Error ? err.message : String(err)).slice(0, 300), investigationLockedBy: null, investigationLockedUntil: null, investigationLockToken: null },
          }).catch(() => {})
        })
        .finally(() => { running--; if (running < env.INVESTIGATION_CONCURRENCY) kick() })
    }
  } catch (e) {
    console.error('[investigation] tick falhou:', (e as Error).message)
  } finally {
    ticking = false
  }
}

export function kick(): void { if (!stopped) setImmediate(() => { void tick() }) }

export function startInvestigationWorker(): void {
  if (!stopped || env.INVESTIGATION_WORKER === 'false') return
  stopped = false
  timer = setInterval(() => { void tick() }, env.INVESTIGATION_POLL_MS)
  timer.unref?.()
  console.log(`[investigation] worker ${INSTANCE_ID} ativo (concorrência ${env.INVESTIGATION_CONCURRENCY}, poll ${env.INVESTIGATION_POLL_MS}ms)`)
  kick()
}

export function stopInvestigationWorker(): void { stopped = true; if (timer) clearInterval(timer); timer = null }

// Resumo do andamento (contadores da UI).
export async function getQueueSummary(nichoId?: string) {
  const where = nichoId ? { nichoId } : {}
  const [byState, byDecision] = await Promise.all([
    prisma.prospect.groupBy({ by: ['investigationState'], where, _count: { _all: true } }),
    prisma.prospect.groupBy({ by: ['websiteStatus'], where, _count: { _all: true } }),
  ])
  return {
    andamento: Object.fromEntries(byState.map((r) => [r.investigationState ?? 'LEGADO', r._count._all])),
    decisao: Object.fromEntries(byDecision.map((r) => [r.websiteStatus ?? 'SEM_DECISAO', r._count._all])),
  }
}
