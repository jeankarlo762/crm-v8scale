import { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { prisma } from '../config/database'
import { authenticate, isRestricted, requireRole } from '../middlewares/auth'
import { httpError } from '../utils/errors'
import { audit } from '../utils/audit'
import { LIMITS, assertActiveUser, idParam, optionalText } from '../utils/validation'

/**
 * Metas do Comercial. Cada meta tem uma métrica, um alvo, um período e (opcionalmente) um vendedor;
 * sem vendedor é meta da equipe. O progresso é calculado na hora a partir dos leads/atividades,
 * então nunca fica desatualizado em relação ao funil.
 */
export const GOAL_METRICS = ['WON_VALUE', 'WON_COUNT', 'LEADS_CREATED', 'ACTIVITIES'] as const
export type GoalMetric = (typeof GOAL_METRICS)[number]

const MAX_TARGET = 999_999_999
// Atividades que o usuário registra à mão; STAGE_CHANGE/OWNER_CHANGE são geradas pelo sistema.
const MANUAL_ACTIVITY_TYPES = ['NOTE', 'CALL', 'WHATSAPP', 'EMAIL', 'MEETING']

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida (use AAAA-MM-DD)')

/** Início do dia / fim do dia (inclusive) em Brasília (UTC-3 fixo). */
const startOf = (d: string) => new Date(`${d}T00:00:00-03:00`)
const endOf = (d: string) => new Date(`${d}T23:59:59.999-03:00`)

const goalShape = {
  title: optionalText(LIMITS.short),
  metric: z.enum(GOAL_METRICS),
  target: z.coerce.number().finite('Meta inválida').positive('A meta deve ser maior que zero').max(MAX_TARGET, 'Valor acima do limite'),
  periodStart: dateOnly,
  periodEnd: dateOnly,
  ownerId: z.string().min(1).max(64).nullish(),
  notes: optionalText(LIMITS.long),
}

function checkPeriod(start?: string, end?: string) {
  if (start && end && start > end) throw httpError(400, 'O fim do período deve ser depois do início')
}

const createSchema = z.object(goalShape)
const updateSchema = z.object(goalShape).partial()

const listQuery = z.object({
  // 'current' = vigentes hoje; 'past' = encerradas; 'upcoming' = futuras; 'all' = todas
  period: z.enum(['current', 'past', 'upcoming', 'all']).default('current'),
  ownerId: z.string().max(64).optional(), // id do usuário, ou 'team' para metas da equipe
})

const goalInclude = {
  owner: { select: { id: true, name: true } },
} satisfies Prisma.GoalInclude

type GoalRow = Prisma.GoalGetPayload<{ include: typeof goalInclude }>

/** Valor atual de uma meta no período dela. Meta da equipe soma todo mundo. */
async function currentValue(g: GoalRow): Promise<number> {
  const range = { gte: g.periodStart, lte: g.periodEnd }
  const owner = g.ownerId ? { ownerId: g.ownerId } : {}
  switch (g.metric as GoalMetric) {
    case 'WON_VALUE': {
      const r = await prisma.lead.aggregate({ _sum: { value: true }, where: { stage: { kind: 'WON' }, stageChangedAt: range, ...owner } })
      return Number(r._sum.value ?? 0)
    }
    case 'WON_COUNT':
      return prisma.lead.count({ where: { stage: { kind: 'WON' }, stageChangedAt: range, ...owner } })
    case 'LEADS_CREATED':
      return prisma.lead.count({ where: { createdAt: range, ...owner } })
    case 'ACTIVITIES':
      return prisma.activity.count({
        where: { type: { in: MANUAL_ACTIVITY_TYPES }, createdAt: range, ...(g.ownerId ? { userId: g.ownerId } : {}) },
      })
    default:
      return 0
  }
}

async function serialize(g: GoalRow) {
  const current = await currentValue(g)
  const target = Number(g.target)
  const now = Date.now()
  const status = now < g.periodStart.getTime() ? 'UPCOMING' : now > g.periodEnd.getTime() ? 'ENDED' : 'ACTIVE'
  return {
    id: g.id,
    title: g.title,
    metric: g.metric,
    target,
    current,
    percent: target > 0 ? Math.round((current / target) * 1000) / 10 : 0,
    periodStart: g.periodStart,
    periodEnd: g.periodEnd,
    status,
    ownerId: g.ownerId,
    owner: g.owner,
    notes: g.notes,
    createdAt: g.createdAt,
  }
}

/** Vendedor só enxerga as próprias metas e as da equipe. */
function scope(request: FastifyRequest): Prisma.GoalWhereInput {
  return isRestricted(request) ? { OR: [{ ownerId: request.user.id }, { ownerId: null }] } : {}
}

export async function goalRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate)

  app.get('/', async (request, reply) => {
    const q = listQuery.parse(request.query)
    const now = new Date()
    const where: Prisma.GoalWhereInput = {
      AND: [
        scope(request),
        q.period === 'current' ? { periodStart: { lte: now }, periodEnd: { gte: now } } : {},
        q.period === 'past' ? { periodEnd: { lt: now } } : {},
        q.period === 'upcoming' ? { periodStart: { gt: now } } : {},
        q.ownerId ? { ownerId: q.ownerId === 'team' ? null : q.ownerId } : {},
      ],
    }
    const goals = await prisma.goal.findMany({
      where,
      include: goalInclude,
      orderBy: [{ periodEnd: q.period === 'past' ? 'desc' : 'asc' }, { createdAt: 'desc' }],
      take: 200,
    })
    return reply.send(await Promise.all(goals.map(serialize)))
  })

  app.post('/', { preHandler: [requireRole('ADMIN', 'MANAGER')] }, async (request, reply) => {
    const input = createSchema.parse(request.body)
    checkPeriod(input.periodStart, input.periodEnd)
    if (input.ownerId) await assertActiveUser(input.ownerId, 'Vendedor')

    const goal = await prisma.goal.create({
      data: {
        title: input.title ?? null,
        metric: input.metric,
        target: input.target,
        periodStart: startOf(input.periodStart),
        periodEnd: endOf(input.periodEnd),
        ownerId: input.ownerId ?? null,
        notes: input.notes ?? null,
        createdById: request.user.id,
      },
      include: goalInclude,
    })
    audit('goal.created', { goalId: goal.id, metric: goal.metric, by: request.user.id })
    return reply.status(201).send(await serialize(goal))
  })

  app.patch('/:id', { preHandler: [requireRole('ADMIN', 'MANAGER')] }, async (request, reply) => {
    const { id } = idParam.parse(request.params)
    const input = updateSchema.parse(request.body)
    const current = await prisma.goal.findUnique({ where: { id } })
    if (!current) throw httpError(404, 'Meta não encontrada')

    // Valida o período final (o que mudou + o que já existia).
    const toKey = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
    checkPeriod(input.periodStart ?? toKey(current.periodStart), input.periodEnd ?? toKey(current.periodEnd))
    if (input.ownerId && input.ownerId !== current.ownerId) await assertActiveUser(input.ownerId, 'Vendedor')

    const goal = await prisma.goal.update({
      where: { id },
      data: {
        ...(input.title !== undefined && { title: input.title }),
        ...(input.metric !== undefined && { metric: input.metric }),
        ...(input.target !== undefined && { target: input.target }),
        ...(input.periodStart !== undefined && { periodStart: startOf(input.periodStart) }),
        ...(input.periodEnd !== undefined && { periodEnd: endOf(input.periodEnd) }),
        ...(input.ownerId !== undefined && { ownerId: input.ownerId ?? null }),
        ...(input.notes !== undefined && { notes: input.notes }),
      },
      include: goalInclude,
    })
    return reply.send(await serialize(goal))
  })

  app.delete('/:id', { preHandler: [requireRole('ADMIN', 'MANAGER')] }, async (request, reply) => {
    const { id } = idParam.parse(request.params)
    const goal = await prisma.goal.findUnique({ where: { id }, select: { id: true } })
    if (!goal) throw httpError(404, 'Meta não encontrada')
    await prisma.goal.delete({ where: { id } })
    audit('goal.deleted', { goalId: id, by: request.user.id })
    return reply.send({ success: true })
  })
}
