import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { prisma } from '../config/database'
import { authenticate, isRestricted } from '../middlewares/auth'

const TZ = 'America/Sao_Paulo'
const DAY_MS = 24 * 60 * 60 * 1000

/** "YYYY-MM-DD" no fuso de São Paulo. */
function dayKey(d: Date): string {
  return d.toLocaleDateString('en-CA', { timeZone: TZ })
}

/** Início do dia (00:00 em Brasília, UTC-3 fixo desde o fim do horário de verão). */
function startOfDay(d: Date): Date {
  return new Date(`${dayKey(d)}T00:00:00-03:00`)
}

export async function dashboardRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate)

  app.get('/commercial', async (request, reply) => {
    const { days } = z.object({ days: z.coerce.number().int().min(1).max(365).default(30) }).parse(request.query)
    const restricted = isRestricted(request)
    const leadScope: Prisma.LeadWhereInput = restricted ? { ownerId: request.user.id } : {}
    const taskScope: Prisma.TaskWhereInput = restricted ? { assigneeId: request.user.id } : {}

    const now = new Date()
    const since = startOfDay(new Date(now.getTime() - (days - 1) * DAY_MS))
    const todayStart = startOfDay(now)
    const todayEnd = new Date(todayStart.getTime() + DAY_MS)

    const [stages, byStage, created, won, lostCount, openByOwner, overdueTasks, todayTasks] = await Promise.all([
      prisma.stage.findMany({ orderBy: { position: 'asc' } }),
      prisma.lead.groupBy({
        by: ['stageId'],
        where: { archived: false, ...leadScope },
        _count: { _all: true },
        _sum: { value: true },
      }),
      prisma.lead.findMany({
        where: { createdAt: { gte: since }, ...leadScope },
        select: { createdAt: true, source: true },
      }),
      prisma.lead.findMany({
        where: { stage: { kind: 'WON' }, stageChangedAt: { gte: since }, ...leadScope },
        select: { value: true, ownerId: true },
      }),
      prisma.lead.count({ where: { stage: { kind: 'LOST' }, stageChangedAt: { gte: since }, ...leadScope } }),
      prisma.lead.groupBy({
        by: ['ownerId'],
        where: { archived: false, stage: { kind: 'OPEN' }, ...leadScope },
        _count: { _all: true },
        _sum: { value: true },
      }),
      prisma.task.count({ where: { done: false, dueAt: { lt: now }, ...taskScope } }),
      prisma.task.count({ where: { done: false, dueAt: { gte: todayStart, lt: todayEnd }, ...taskScope } }),
    ])

    // Funil: uma linha por etapa, mesmo as vazias.
    const stageStats = new Map(byStage.map((g) => [g.stageId, g]))
    const funnel = stages.map((s) => ({
      id: s.id,
      name: s.name,
      color: s.color,
      kind: s.kind,
      count: stageStats.get(s.id)?._count._all ?? 0,
      value: Number(stageStats.get(s.id)?._sum.value ?? 0),
    }))

    const open = funnel.filter((f) => f.kind === 'OPEN')
    const wonValue = won.reduce((sum, l) => sum + Number(l.value), 0)
    const decided = won.length + lostCount

    // Leads criados por dia (todos os dias do período, inclusive zerados).
    const perDayMap = new Map<string, number>()
    for (let i = 0; i < days; i++) perDayMap.set(dayKey(new Date(since.getTime() + i * DAY_MS)), 0)
    for (const l of created) {
      const k = dayKey(l.createdAt)
      if (perDayMap.has(k)) perDayMap.set(k, (perDayMap.get(k) ?? 0) + 1)
    }

    const sourceMap = new Map<string, number>()
    for (const l of created) {
      const k = l.source || 'Sem origem'
      sourceMap.set(k, (sourceMap.get(k) ?? 0) + 1)
    }

    // Ranking por vendedor: ganhos no período + pipeline aberto atual.
    const sellerMap = new Map<string, { wonCount: number; wonValue: number; openCount: number; openValue: number }>()
    const seller = (id: string) => {
      if (!sellerMap.has(id)) sellerMap.set(id, { wonCount: 0, wonValue: 0, openCount: 0, openValue: 0 })
      return sellerMap.get(id)!
    }
    for (const l of won) {
      const s = seller(l.ownerId ?? 'none')
      s.wonCount += 1
      s.wonValue += Number(l.value)
    }
    for (const g of openByOwner) {
      const s = seller(g.ownerId ?? 'none')
      s.openCount = g._count._all
      s.openValue = Number(g._sum.value ?? 0)
    }
    const owners = await prisma.user.findMany({
      where: { id: { in: [...sellerMap.keys()].filter((k) => k !== 'none') } },
      select: { id: true, name: true },
    })
    const nameOf = new Map(owners.map((u) => [u.id, u.name]))
    const bySeller = [...sellerMap.entries()]
      .map(([id, v]) => ({ id, name: id === 'none' ? 'Sem responsável' : (nameOf.get(id) ?? 'Removido'), ...v }))
      .sort((a, b) => b.wonValue - a.wonValue || b.openValue - a.openValue)

    return reply.send({
      days,
      kpis: {
        openLeads: open.reduce((s, f) => s + f.count, 0),
        pipelineValue: open.reduce((s, f) => s + f.value, 0),
        newLeads: created.length,
        wonCount: won.length,
        wonValue,
        lostCount,
        conversionRate: decided > 0 ? Math.round((won.length / decided) * 1000) / 10 : null,
        overdueTasks,
        todayTasks,
      },
      funnel,
      leadsPerDay: [...perDayMap.entries()].map(([date, count]) => ({ date, count })),
      bySource: [...sourceMap.entries()].map(([source, count]) => ({ source, count })).sort((a, b) => b.count - a.count),
      bySeller,
    })
  })
}
