import { Prisma } from '@prisma/client'
import { prisma } from '../config/database'
import { STATUS_CONTATO } from '../schemas/lead.schema'

/**
 * Módulo de Relatórios (ADMIN/MANAGER). Tudo é calculado na hora a partir das tabelas operacionais,
 * então os números nunca ficam defasados em relação ao funil, à Prospecção e às Campanhas.
 */

const TZ = 'America/Sao_Paulo'
const DAY_MS = 86_400_000

export interface Period { from?: Date; to?: Date }

/** "AAAA-MM-DD" (Brasília) → início / fim do dia. */
export function parsePeriod(from?: string, to?: string): Period {
  return {
    from: from ? new Date(`${from}T00:00:00-03:00`) : undefined,
    to: to ? new Date(`${to}T23:59:59.999-03:00`) : undefined,
  }
}

const dateWhere = (p: Period): Prisma.DateTimeFilter | undefined =>
  p.from || p.to ? { ...(p.from ? { gte: p.from } : {}), ...(p.to ? { lte: p.to } : {}) } : undefined

const inPeriod = (d: Date | null | undefined, p: Period): boolean =>
  !!d && (!p.from || d >= p.from) && (!p.to || d <= p.to)

const dayKey = (d: Date): string => d.toLocaleDateString('en-CA', { timeZone: TZ })
const num = (v: Prisma.Decimal | number | null | undefined): number => (v == null ? 0 : Number(v))
const pct = (a: number, b: number): number => (b > 0 ? Math.round((a / b) * 1000) / 10 : 0)
const round1 = (n: number): number => Math.round(n * 10) / 10

type Series = Record<string, Record<string, number>>
function bump(series: Series, day: string, field: string, by = 1) {
  const row = (series[day] ??= {})
  row[field] = (row[field] ?? 0) + by
}
function toSeries(series: Series, fields: string[]) {
  return Object.keys(series).sort().map((day) => ({ day, ...Object.fromEntries(fields.map((f) => [f, series[day][f] ?? 0])) }))
}

// ─── Campanhas ───────────────────────────────────────────────────────────────

export interface CampaignReportFilter extends Period { responsavelId?: string }

export async function campaignsReport(f: CampaignReportFilter) {
  const campaigns = await prisma.campaign.findMany({
    where: {
      ...(dateWhere(f) ? { createdAt: dateWhere(f) } : {}),
      ...(f.responsavelId ? { responsavelId: f.responsavelId } : {}),
    },
    orderBy: { createdAt: 'desc' },
    include: { responsavel: { select: { id: true, name: true } } },
  })
  const ids = campaigns.map((c) => c.id)
  const recipients = ids.length === 0 ? [] : await prisma.campaignRecipient.findMany({
    where: { campaignId: { in: ids } },
    select: {
      campaignId: true, status: true, sentAt: true, repliedAt: true, replyCount: true,
      prospect: { select: { status: true, convertedLead: { select: { value: true, stage: { select: { kind: true } } } } } },
    },
  })

  type Agg = {
    total: number; sent: number; failed: number; skipped: number; pending: number
    replied: number; replies: number; negotiating: number; closed: number
    leads: number; leadsWon: number; wonValue: number; firstSentAt: Date | null; lastSentAt: Date | null
  }
  const blank = (): Agg => ({ total: 0, sent: 0, failed: 0, skipped: 0, pending: 0, replied: 0, replies: 0, negotiating: 0, closed: 0, leads: 0, leadsWon: 0, wonValue: 0, firstSentAt: null, lastSentAt: null })
  const byCampaign = new Map<string, Agg>()
  const series: Series = {}

  for (const r of recipients) {
    const a = byCampaign.get(r.campaignId) ?? blank()
    byCampaign.set(r.campaignId, a)
    a.total++
    if (r.status === 'SENT') a.sent++
    else if (r.status === 'FAILED') a.failed++
    else if (r.status === 'SKIPPED') a.skipped++
    else a.pending++
    if (r.sentAt) {
      if (!a.firstSentAt || r.sentAt < a.firstSentAt) a.firstSentAt = r.sentAt
      if (!a.lastSentAt || r.sentAt > a.lastSentAt) a.lastSentAt = r.sentAt
      bump(series, dayKey(r.sentAt), 'enviadas')
    }
    if (r.repliedAt) {
      a.replied++
      a.replies += r.replyCount
      bump(series, dayKey(r.repliedAt), 'respostas')
    }
    if (r.prospect?.status === 'negociando') a.negotiating++
    if (r.prospect?.status === 'fechado') a.closed++
    const lead = r.prospect?.convertedLead
    if (lead) {
      a.leads++
      if (lead.stage.kind === 'WON') { a.leadsWon++; a.wonValue += num(lead.value) }
    }
  }

  const total = blank()
  const byUserMap = new Map<string, { userId: string | null; name: string; campaigns: number } & Agg>()
  const rows = campaigns.map((c) => {
    const a = byCampaign.get(c.id) ?? blank()
    for (const k of ['total', 'sent', 'failed', 'skipped', 'pending', 'replied', 'replies', 'negotiating', 'closed', 'leads', 'leadsWon', 'wonValue'] as const) total[k] += a[k]
    const ukey = c.responsavelId ?? '_none'
    const u = byUserMap.get(ukey) ?? { userId: c.responsavelId, name: c.responsavel?.name ?? 'Sem responsável', campaigns: 0, ...blank() }
    byUserMap.set(ukey, u)
    u.campaigns++
    for (const k of ['total', 'sent', 'failed', 'skipped', 'pending', 'replied', 'replies', 'negotiating', 'closed', 'leads', 'leadsWon', 'wonValue'] as const) u[k] += a[k]
    return {
      id: c.id, name: c.name, status: c.status, nicho: c.nichoNome, estado: c.estado, cidade: c.cidade,
      selecionados: c.selecionados, createdAt: c.createdAt,
      responsavel: c.responsavel ? { id: c.responsavel.id, name: c.responsavel.name } : null,
      ...a, replyRate: pct(a.replied, a.sent), conversionRate: pct(a.leads, a.sent),
    }
  })

  return {
    totals: { campaigns: campaigns.length, ...total, replyRate: pct(total.replied, total.sent), conversionRate: pct(total.leads, total.sent) },
    campaigns: rows,
    byUser: [...byUserMap.values()].map((u) => ({ ...u, replyRate: pct(u.replied, u.sent) })).sort((x, y) => y.replied - x.replied),
    series: toSeries(series, ['enviadas', 'respostas']),
  }
}

/** Quem recebeu a campanha, com a resposta de cada um (para listar "quem chamou"). */
export async function campaignRecipientsReport(campaignId: string, onlyReplied: boolean) {
  const campaign = await prisma.campaign.findUnique({ where: { id: campaignId }, select: { id: true, name: true } })
  if (!campaign) return null
  const rows = await prisma.campaignRecipient.findMany({
    where: { campaignId, ...(onlyReplied ? { repliedAt: { not: null } } : {}) },
    orderBy: onlyReplied ? { repliedAt: 'desc' } : { createdAt: 'asc' },
    select: {
      id: true, name: true, phone: true, status: true, sentAt: true, repliedAt: true, lastReplyAt: true, replyCount: true, error: true, skipReason: true,
      prospect: { select: { id: true, arenaName: true, city: true, state: true, status: true, convertedLead: { select: { id: true, value: true, stage: { select: { name: true, kind: true } } } } } },
    },
  })
  return { campaign, recipients: rows.map((r) => ({ ...r, prospect: r.prospect && { ...r.prospect, convertedLead: r.prospect.convertedLead && { ...r.prospect.convertedLead, value: num(r.prospect.convertedLead.value) } } })) }
}

// ─── Usuários ────────────────────────────────────────────────────────────────

export async function usersReport(p: Period) {
  const range = dateWhere(p)
  const [users, leadsByOwner, leadsCreated, activities, tasksOpen, tasksOverdue, tasksDone, prospects, campaigns, goals, lastLogin, lastAct] = await Promise.all([
    prisma.user.findMany({ orderBy: [{ active: 'desc' }, { name: 'asc' }], select: { id: true, name: true, email: true, phone: true, role: true, active: true, createdAt: true, updatedAt: true } }),
    prisma.lead.findMany({ where: { archived: false, ownerId: { not: null } }, select: { ownerId: true, value: true, stageChangedAt: true, createdAt: true, stage: { select: { kind: true } } } }),
    prisma.lead.groupBy({ by: ['ownerId'], where: { ownerId: { not: null }, ...(range ? { createdAt: range } : {}) }, _count: { _all: true } }),
    prisma.activity.groupBy({ by: ['userId', 'type'], where: { userId: { not: null }, type: { in: ['NOTE', 'CALL', 'WHATSAPP', 'EMAIL', 'MEETING'] }, ...(range ? { createdAt: range } : {}) }, _count: { _all: true } }),
    prisma.task.groupBy({ by: ['assigneeId'], where: { done: false, assigneeId: { not: null } }, _count: { _all: true } }),
    prisma.task.groupBy({ by: ['assigneeId'], where: { done: false, dueAt: { lt: new Date() }, assigneeId: { not: null } }, _count: { _all: true } }),
    prisma.task.groupBy({ by: ['assigneeId'], where: { done: true, assigneeId: { not: null }, ...(range ? { doneAt: range } : {}) }, _count: { _all: true } }),
    prisma.prospect.groupBy({ by: ['responsavel', 'status'], where: { responsavel: { not: null } }, _count: { _all: true } }),
    prisma.campaign.findMany({ where: { responsavelId: { not: null }, ...(range ? { createdAt: range } : {}) }, select: { id: true, responsavelId: true } }),
    prisma.goal.groupBy({ by: ['ownerId'], where: { ownerId: { not: null }, periodEnd: { gte: new Date() } }, _count: { _all: true } }),
    prisma.refreshToken.groupBy({ by: ['userId'], _max: { createdAt: true } }),
    prisma.activity.groupBy({ by: ['userId'], where: { userId: { not: null } }, _max: { createdAt: true } }),
  ])

  const campaignIds = campaigns.map((c) => c.id)
  const recipientAgg = campaignIds.length === 0 ? [] : await prisma.campaignRecipient.findMany({
    where: { campaignId: { in: campaignIds } }, select: { campaignId: true, status: true, repliedAt: true },
  })
  const ownerOfCampaign = new Map(campaigns.map((c) => [c.id, c.responsavelId as string]))

  const rows = users.map((u) => {
    const leads = leadsByOwner.filter((l) => l.ownerId === u.id)
    const open = leads.filter((l) => l.stage.kind === 'OPEN')
    const won = leads.filter((l) => l.stage.kind === 'WON')
    const lost = leads.filter((l) => l.stage.kind === 'LOST')
    const wonInPeriod = won.filter((l) => inPeriod(l.stageChangedAt, p))
    const lostInPeriod = lost.filter((l) => inPeriod(l.stageChangedAt, p))
    const acts = activities.filter((a) => a.userId === u.id)
    const byType = Object.fromEntries(acts.map((a) => [a.type, a._count._all]))
    const mine = recipientAgg.filter((r) => ownerOfCampaign.get(r.campaignId) === u.id)
    const sent = mine.filter((r) => r.status === 'SENT').length
    const replied = mine.filter((r) => r.repliedAt).length
    const myProspects = prospects.filter((x) => x.responsavel === u.id)
    const prospectCount = (s?: string) => myProspects.filter((x) => !s || x.status === s).reduce((n, x) => n + x._count._all, 0)
    const cnt = <T extends { _count: { _all: number } }>(arr: (T & Record<string, unknown>)[], key: string) => arr.find((x) => x[key] === u.id)?._count._all ?? 0
    return {
      ...u,
      // Melhor esforço: o refresh token some no logout, então combina o último login ainda ativo com a última atividade registrada.
      lastActivityAt: [lastLogin.find((l) => l.userId === u.id)?._max.createdAt, lastAct.find((l) => l.userId === u.id)?._max.createdAt]
        .filter((x): x is Date => !!x).sort((a, b) => b.getTime() - a.getTime())[0] ?? null,
      leads: {
        owned: leads.length, open: open.length, openValue: open.reduce((s, l) => s + num(l.value), 0),
        created: cnt(leadsCreated, 'ownerId'),
        won: wonInPeriod.length, wonValue: wonInPeriod.reduce((s, l) => s + num(l.value), 0),
        lost: lostInPeriod.length,
        winRate: pct(wonInPeriod.length, wonInPeriod.length + lostInPeriod.length),
      },
      activities: { total: acts.reduce((n, a) => n + a._count._all, 0), byType },
      tasks: { open: cnt(tasksOpen, 'assigneeId'), overdue: cnt(tasksOverdue, 'assigneeId'), done: cnt(tasksDone, 'assigneeId') },
      prospects: { total: prospectCount(), negotiating: prospectCount('negociando'), closed: prospectCount('fechado'), refused: prospectCount('recusado') },
      campaigns: { count: campaignIds.filter((id) => ownerOfCampaign.get(id) === u.id).length, sent, replied, replyRate: pct(replied, sent) },
      goalsActive: cnt(goals, 'ownerId'),
    }
  })

  return {
    totals: {
      users: rows.length, active: rows.filter((u) => u.active).length,
      byRole: { ADMIN: rows.filter((u) => u.role === 'ADMIN').length, MANAGER: rows.filter((u) => u.role === 'MANAGER').length, SELLER: rows.filter((u) => u.role === 'SELLER').length },
    },
    users: rows,
  }
}

// ─── Comercial ───────────────────────────────────────────────────────────────

export async function commercialReport(p: Period & { ownerId?: string }) {
  const owner: Prisma.LeadWhereInput = p.ownerId === 'none' ? { ownerId: null } : p.ownerId ? { ownerId: p.ownerId } : {}
  const range = dateWhere(p)
  const [created, closed, open, users, customers, newCustomers, churned] = await Promise.all([
    prisma.lead.findMany({ where: { ...owner, ...(range ? { createdAt: range } : {}) }, select: { createdAt: true, source: true, ownerId: true } }),
    prisma.lead.findMany({
      where: { ...owner, stage: { kind: { in: ['WON', 'LOST'] } }, ...(range ? { stageChangedAt: range } : {}) },
      select: { id: true, name: true, value: true, source: true, ownerId: true, lostReason: true, createdAt: true, stageChangedAt: true, stage: { select: { kind: true } } },
    }),
    prisma.lead.findMany({ where: { ...owner, archived: false, stage: { kind: 'OPEN' } }, select: { value: true, ownerId: true } }),
    prisma.user.findMany({ select: { id: true, name: true } }),
    prisma.customer.findMany({ where: { active: true }, select: { mrrValue: true } }),
    prisma.customer.count({ where: range ? { createdAt: range } : {} }),
    prisma.customer.count({ where: { churnedAt: range ?? { not: null } } }),
  ])
  const nameOf = new Map(users.map((u) => [u.id, u.name]))
  const won = closed.filter((l) => l.stage.kind === 'WON')
  const lost = closed.filter((l) => l.stage.kind === 'LOST')
  const wonValue = won.reduce((s, l) => s + num(l.value), 0)
  const cycleDays = won.length ? won.reduce((s, l) => s + (l.stageChangedAt.getTime() - l.createdAt.getTime()) / DAY_MS, 0) / won.length : 0

  type G = { key: string; label: string; created: number; won: number; lost: number; wonValue: number; openCount: number; openValue: number }
  const group = (keyOf: (l: { source: string | null; ownerId: string | null }) => string, labelOf: (k: string) => string) => {
    const m = new Map<string, G>()
    const get = (key: string) => { let g = m.get(key); if (!g) { g = { key, label: labelOf(key), created: 0, won: 0, lost: 0, wonValue: 0, openCount: 0, openValue: 0 }; m.set(key, g) } return g }
    created.forEach((l) => { get(keyOf(l)).created++ })
    won.forEach((l) => { const g = get(keyOf(l)); g.won++; g.wonValue += num(l.value) })
    lost.forEach((l) => { get(keyOf(l)).lost++ })
    return [...m.values()].map((g) => ({ ...g, winRate: pct(g.won, g.won + g.lost) })).sort((a, b) => b.wonValue - a.wonValue || b.created - a.created)
  }
  const bySource = group((l) => l.source?.trim() || '—', (k) => (k === '—' ? 'Sem origem' : k))
  const byOwner = group((l) => l.ownerId ?? '_none', (k) => (k === '_none' ? 'Sem responsável' : nameOf.get(k) ?? 'Usuário removido'))
  open.forEach((l) => {
    const g = byOwner.find((x) => x.key === (l.ownerId ?? '_none'))
    if (g) { g.openCount++; g.openValue += num(l.value) }
    else byOwner.push({ key: l.ownerId ?? '_none', label: l.ownerId ? nameOf.get(l.ownerId) ?? 'Usuário removido' : 'Sem responsável', created: 0, won: 0, lost: 0, wonValue: 0, openCount: 1, openValue: num(l.value), winRate: 0 })
  })

  const lostReasons = new Map<string, number>()
  lost.forEach((l) => { const r = l.lostReason?.trim() || 'Sem motivo'; lostReasons.set(r, (lostReasons.get(r) ?? 0) + 1) })

  const series: Series = {}
  created.forEach((l) => bump(series, dayKey(l.createdAt), 'criados'))
  won.forEach((l) => { bump(series, dayKey(l.stageChangedAt), 'ganhos'); bump(series, dayKey(l.stageChangedAt), 'valor', num(l.value)) })

  return {
    kpis: {
      created: created.length, won: won.length, lost: lost.length, wonValue,
      avgTicket: won.length ? wonValue / won.length : 0, winRate: pct(won.length, won.length + lost.length), avgCycleDays: round1(cycleDays),
      openCount: open.length, openValue: open.reduce((s, l) => s + num(l.value), 0),
      activeCustomers: customers.length, mrr: customers.reduce((s, c) => s + num(c.mrrValue), 0), newCustomers, churned,
    },
    bySource, byOwner,
    lostReasons: [...lostReasons.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count),
    recentWins: won.sort((a, b) => b.stageChangedAt.getTime() - a.stageChangedAt.getTime()).slice(0, 10)
      .map((l) => ({ id: l.id, name: l.name, value: num(l.value), source: l.source, owner: l.ownerId ? nameOf.get(l.ownerId) ?? null : null, closedAt: l.stageChangedAt })),
    series: toSeries(series, ['criados', 'ganhos', 'valor']),
  }
}

// ─── Prospecção ──────────────────────────────────────────────────────────────

export async function prospectingReport(p: Period) {
  const range = dateWhere(p)
  const [prospects, nichos, users, searches, repliedProspects] = await Promise.all([
    prisma.prospect.findMany({
      select: {
        id: true, status: true, statusSite: true, websiteStatus: true, state: true, responsavel: true, nichoId: true, createdAt: true,
        whatsapp: true, convertedLeadId: true,
      },
    }),
    prisma.nicho.findMany({ select: { id: true, nome: true } }),
    prisma.user.findMany({ select: { id: true, name: true } }),
    prisma.buscaLog.aggregate({ where: { mock: false, ...(range ? { criadoEm: range } : {}) }, _count: { _all: true }, _sum: { numChamadas: true } }),
    prisma.campaignRecipient.findMany({ where: { repliedAt: { not: null }, prospectId: { not: null } }, select: { prospectId: true }, distinct: ['prospectId'] }),
  ])
  const nichoName = new Map(nichos.map((n) => [n.id, n.nome]))
  const userName = new Map(users.map((u) => [u.id, u.name]))
  const replied = new Set(repliedProspects.map((r) => r.prospectId))
  const scoped = range ? prospects.filter((x) => inPeriod(x.createdAt, p)) : prospects

  const countBy = (list: typeof prospects, keyOf: (x: (typeof prospects)[number]) => string | null) => {
    const m = new Map<string, number>()
    list.forEach((x) => { const k = keyOf(x) ?? '—'; m.set(k, (m.get(k) ?? 0) + 1) })
    return m
  }
  const dist = (m: Map<string, number>, labelOf: (k: string) => string = (k) => k) =>
    [...m.entries()].map(([key, count]) => ({ key, label: labelOf(key), count })).sort((a, b) => b.count - a.count)

  const contacted = (x: (typeof prospects)[number]) => x.status !== 'nao_contatado'
  const byNicho = [...new Set(scoped.map((x) => x.nichoId))].map((id) => {
    const l = scoped.filter((x) => x.nichoId === id)
    return {
      key: id ?? '_none', label: id ? nichoName.get(id) ?? '—' : 'Sem nicho', total: l.length,
      withWhatsapp: l.filter((x) => x.whatsapp).length, contacted: l.filter(contacted).length,
      negotiating: l.filter((x) => x.status === 'negociando').length, closed: l.filter((x) => x.status === 'fechado').length,
      converted: l.filter((x) => x.convertedLeadId).length,
    }
  }).sort((a, b) => b.total - a.total)

  const byResponsavel = [...new Set(scoped.map((x) => x.responsavel))].map((id) => {
    const l = scoped.filter((x) => x.responsavel === id)
    return {
      key: id ?? '_none', label: id ? userName.get(id) ?? 'Usuário removido' : 'Sem responsável', total: l.length,
      contacted: l.filter(contacted).length, negotiating: l.filter((x) => x.status === 'negociando').length, closed: l.filter((x) => x.status === 'fechado').length,
    }
  }).sort((a, b) => b.total - a.total)

  const series: Series = {}
  scoped.forEach((x) => bump(series, dayKey(x.createdAt), 'novos'))

  const total = scoped.length
  const withWhatsapp = scoped.filter((x) => x.whatsapp).length
  const contactedN = scoped.filter(contacted).length
  const repliedN = scoped.filter((x) => replied.has(x.id)).length

  return {
    totals: {
      prospects: prospects.length, inPeriod: total, withWhatsapp, contacted: contactedN, replied: repliedN,
      negotiating: scoped.filter((x) => x.status === 'negociando').length, closed: scoped.filter((x) => x.status === 'fechado').length,
      converted: scoped.filter((x) => x.convertedLeadId).length,
      searches: searches._count._all, apiCalls: searches._sum.numChamadas ?? 0,
    },
    funnel: [
      { key: 'total', label: 'Prospects', count: total },
      { key: 'whatsapp', label: 'Com WhatsApp', count: withWhatsapp },
      { key: 'contacted', label: 'Contatados', count: contactedN },
      { key: 'replied', label: 'Responderam à campanha', count: repliedN },
      { key: 'negotiating', label: 'Negociando ou fechado', count: scoped.filter((x) => x.status === 'negociando' || x.status === 'fechado').length },
      { key: 'converted', label: 'Viraram lead no funil', count: scoped.filter((x) => x.convertedLeadId).length },
    ],
    byStatus: STATUS_CONTATO.map((s) => ({ key: s, label: s, count: scoped.filter((x) => x.status === s).length })),
    bySite: dist(countBy(scoped, (x) => x.statusSite)),
    byWebsiteDecision: dist(countBy(scoped, (x) => x.websiteStatus)),
    byState: dist(countBy(scoped, (x) => x.state)).slice(0, 15),
    byNicho: byNicho.slice(0, 20),
    byResponsavel,
    series: toSeries(series, ['novos']),
  }
}

// ─── Funil ───────────────────────────────────────────────────────────────────

const STUCK_DAYS = 14

export async function funnelReport(p: Period & { ownerId?: string }) {
  const owner: Prisma.LeadWhereInput = p.ownerId === 'none' ? { ownerId: null } : p.ownerId ? { ownerId: p.ownerId } : {}
  const range = dateWhere(p)
  const [stages, leads, moves, users] = await Promise.all([
    prisma.stage.findMany({ orderBy: { position: 'asc' } }),
    prisma.lead.findMany({ where: { ...owner, archived: false }, select: { stageId: true, value: true, ownerId: true, stageChangedAt: true, createdAt: true } }),
    prisma.activity.findMany({
      where: { type: 'STAGE_CHANGE', ...(range ? { createdAt: range } : {}), ...(p.ownerId && p.ownerId !== 'none' ? { lead: { ownerId: p.ownerId } } : {}) },
      select: { content: true },
    }),
    prisma.user.findMany({ select: { id: true, name: true } }),
  ])
  const now = Date.now()
  // "Etapa A → Etapa B · Motivo: ...": conta as entradas por nome da etapa de destino.
  const entries = new Map<string, number>()
  for (const m of moves) {
    const to = m.content.split('→').pop()?.split(' · ')[0]?.trim()
    if (to) entries.set(to, (entries.get(to) ?? 0) + 1)
  }
  const totalLeads = leads.length
  const rows = stages.map((s) => {
    const l = leads.filter((x) => x.stageId === s.id)
    const days = l.map((x) => (now - x.stageChangedAt.getTime()) / DAY_MS)
    return {
      id: s.id, name: s.name, color: s.color, kind: s.kind, position: s.position,
      count: l.length, value: l.reduce((a, x) => a + num(x.value), 0), share: pct(l.length, totalLeads),
      avgDaysInStage: l.length ? round1(days.reduce((a, d) => a + d, 0) / l.length) : 0,
      stuck: s.kind === 'OPEN' ? days.filter((d) => d > STUCK_DAYS).length : 0,
      enteredInPeriod: entries.get(s.name) ?? 0,
    }
  })
  const openStages = rows.filter((r) => r.kind === 'OPEN')
  const owners = [...new Set(leads.map((l) => l.ownerId))].map((id) => ({
    key: id ?? '_none', label: id ? users.find((u) => u.id === id)?.name ?? 'Usuário removido' : 'Sem responsável',
    total: leads.filter((l) => l.ownerId === id).length,
    byStage: Object.fromEntries(stages.map((s) => [s.id, leads.filter((l) => l.ownerId === id && l.stageId === s.id).length])),
  })).sort((a, b) => b.total - a.total)

  return {
    totals: {
      leads: totalLeads,
      open: openStages.reduce((a, r) => a + r.count, 0), openValue: openStages.reduce((a, r) => a + r.value, 0),
      won: rows.filter((r) => r.kind === 'WON').reduce((a, r) => a + r.count, 0),
      lost: rows.filter((r) => r.kind === 'LOST').reduce((a, r) => a + r.count, 0),
      stuck: openStages.reduce((a, r) => a + r.stuck, 0), stuckDays: STUCK_DAYS,
      movesInPeriod: moves.length,
    },
    stages: rows,
    owners,
  }
}
