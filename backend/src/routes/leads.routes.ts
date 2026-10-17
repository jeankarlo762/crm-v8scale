import { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { prisma } from '../config/database'
import { authenticate, isRestricted, requireRole } from '../middlewares/auth'
import { httpError } from '../utils/errors'
import { audit } from '../utils/audit'
import { LIMITS, assertActiveUser, emailField, idParam, moneyField, optionalText, requiredText } from '../utils/validation'

const dateField = z
  .string()
  .max(40)
  .nullish()
  .refine((v) => !v || !Number.isNaN(new Date(v).getTime()), 'Data inválida')
  .transform((v) => (v === undefined ? undefined : v ? new Date(v) : null))

const leadShape = {
  name: requiredText(LIMITS.short, 'Nome'),
  contactName: optionalText(LIMITS.short),
  email: emailField,
  phone: optionalText(40),
  document: optionalText(40),
  city: optionalText(LIMITS.short),
  state: optionalText(2),
  source: optionalText(LIMITS.medium),
  segment: optionalText(LIMITS.medium),
  value: moneyField,
  notes: optionalText(LIMITS.long),
  stageId: z.string().min(1).max(64),
  ownerId: z.string().max(64).nullish(),
  expectedCloseAt: dateField,
}

const createSchema = z.object({
  ...leadShape,
  value: leadShape.value.default(0),
  stageId: leadShape.stageId.optional(),
})
const updateSchema = z.object({ ...leadShape, archived: z.boolean() }).partial()

const listQuery = z.object({
  q: z.string().trim().max(LIMITS.short).optional(),
  stageId: z.string().max(64).optional(),
  ownerId: z.string().max(64).optional(), // id do usuário, ou 'none' para leads sem responsável
  source: z.string().max(LIMITS.medium).optional(),
  archived: z.enum(['true', 'false']).default('false'),
  limit: z.coerce.number().int().min(1).max(2000).default(1000),
})

const activitySchema = z.object({
  type: z.enum(['NOTE', 'CALL', 'WHATSAPP', 'EMAIL', 'MEETING']),
  content: requiredText(LIMITS.long, 'Descrição'),
})
const ownerSchema = z.object({ ownerId: z.string().min(1).max(64).nullable() })
const bulkOwnerSchema = z.object({
  ids: z.array(z.string().min(1).max(64)).min(1, 'Selecione ao menos um lead').max(500),
  ownerId: z.string().min(1).max(64).nullable(),
})

const stageChangeSchema = z.object({
  stageId: z.string().min(1).max(64),
  lostReason: z.string().trim().max(LIMITS.medium).optional(),
})

const leadInclude = {
  stage: true,
  owner: { select: { id: true, name: true } },
  _count: { select: { tasks: { where: { done: false } } } },
} satisfies Prisma.LeadInclude

type LeadWithRels = Prisma.LeadGetPayload<{ include: typeof leadInclude }>

function serialize(lead: LeadWithRels) {
  const { _count, value, ...rest } = lead
  return { ...rest, value: Number(value), openTasks: _count.tasks }
}

function scope(request: FastifyRequest): Prisma.LeadWhereInput {
  return isRestricted(request) ? { ownerId: request.user.id } : {}
}

async function findScoped(request: FastifyRequest, id: string) {
  const lead = await prisma.lead.findFirst({ where: { id, ...scope(request) }, include: leadInclude })
  if (!lead) throw httpError(404, 'Lead não encontrado')
  return lead
}

/**
 * Troca o responsável de um lead dentro de uma transação: registra no histórico
 * quem passou para quem e leva junto as tarefas em aberto que estavam com o
 * responsável anterior (senão o novo dono não as vê, e o antigo continua cobrado).
 */
async function reassignOwner(
  tx: Prisma.TransactionClient,
  lead: { id: string; ownerId: string | null },
  newOwnerId: string | null,
  byUserId: string,
) {
  if (lead.ownerId === newOwnerId) return false
  const ids = [lead.ownerId, newOwnerId].filter((v): v is string => !!v)
  const users = ids.length ? await tx.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : []
  const nameOf = (uid: string | null) => (uid ? users.find((u) => u.id === uid)?.name ?? 'usuário removido' : 'Sem responsável')

  await tx.lead.update({ where: { id: lead.id }, data: { ownerId: newOwnerId } })
  if (newOwnerId) {
    await tx.task.updateMany({
      where: { leadId: lead.id, done: false, ...(lead.ownerId ? { assigneeId: lead.ownerId } : { assigneeId: null }) },
      data: { assigneeId: newOwnerId },
    })
  }
  await tx.activity.create({
    data: { leadId: lead.id, userId: byUserId, type: 'OWNER_CHANGE', content: `Responsável: ${nameOf(lead.ownerId)} → ${nameOf(newOwnerId)}` },
  })
  return true
}

export async function leadRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate)

  app.get('/', async (request, reply) => {
    const q = listQuery.parse(request.query)
    const where: Prisma.LeadWhereInput = {
      archived: q.archived === 'true',
      ...(q.stageId && { stageId: q.stageId }),
      ...(q.ownerId && { ownerId: q.ownerId === 'none' ? null : q.ownerId }),
      ...(q.source && { source: q.source }),
      ...(q.q && {
        OR: [
          { name: { contains: q.q, mode: 'insensitive' } },
          { contactName: { contains: q.q, mode: 'insensitive' } },
          { email: { contains: q.q, mode: 'insensitive' } },
          { phone: { contains: q.q } },
          { document: { contains: q.q } },
        ],
      }),
      ...scope(request),
    }
    const leads = await prisma.lead.findMany({
      where, include: leadInclude, orderBy: { updatedAt: 'desc' }, take: q.limit,
    })
    return reply.send(leads.map(serialize))
  })

  app.post('/', async (request, reply) => {
    const input = createSchema.parse(request.body)

    const stage = input.stageId
      ? await prisma.stage.findUnique({ where: { id: input.stageId } })
      : await prisma.stage.findFirst({ orderBy: { position: 'asc' } })
    if (!stage) throw httpError(400, 'Etapa inválida')
    if (stage.kind !== 'OPEN') throw httpError(400, 'Um novo lead deve entrar numa etapa em aberto')

    // Vendedor só cria leads para si mesmo.
    const ownerId = isRestricted(request) ? request.user.id : (input.ownerId ?? request.user.id)
    if (ownerId !== request.user.id) await assertActiveUser(ownerId)

    const lead = await prisma.lead.create({
      data: {
        name: input.name,
        contactName: input.contactName ?? null,
        email: input.email ?? null,
        phone: input.phone ?? null,
        document: input.document ?? null,
        city: input.city ?? null,
        state: input.state ?? null,
        source: input.source ?? null,
        segment: input.segment ?? null,
        value: input.value,
        notes: input.notes ?? null,
        expectedCloseAt: input.expectedCloseAt ?? null,
        stageId: stage.id,
        ownerId,
        activities: { create: { type: 'NOTE', userId: request.user.id, content: 'Lead criado' } },
      },
      include: leadInclude,
    })
    return reply.status(201).send(serialize(lead))
  })

  app.get('/:id', async (request, reply) => {
    const { id } = idParam.parse(request.params)
    const lead = await findScoped(request, id)
    const [activities, tasks] = await Promise.all([
      prisma.activity.findMany({
        where: { leadId: id },
        orderBy: { createdAt: 'desc' },
        include: { user: { select: { id: true, name: true } } },
      }),
      prisma.task.findMany({
        where: { leadId: id },
        orderBy: [{ done: 'asc' }, { dueAt: 'asc' }],
        include: { assignee: { select: { id: true, name: true } } },
      }),
    ])
    return reply.send({ ...serialize(lead), activities, tasks })
  })

  app.patch('/:id', async (request, reply) => {
    const { id } = idParam.parse(request.params)
    const input = updateSchema.parse(request.body)
    await findScoped(request, id)

    // Vendedor não reatribui o lead para outra pessoa.
    if (input.ownerId !== undefined && isRestricted(request) && input.ownerId !== request.user.id) {
      throw httpError(403, 'Apenas gerentes podem reatribuir leads')
    }
    // A etapa só muda por /:id/stage (que registra histórico e regras de ganho/perda);
    // o responsável passa por reassignOwner (histórico + tarefas em aberto).
    const { stageId: _ignored, ownerId, ...data } = input
    const current = await prisma.lead.findUniqueOrThrow({ where: { id }, select: { id: true, ownerId: true } })
    if (ownerId && ownerId !== current.ownerId) await assertActiveUser(ownerId)

    await prisma.$transaction(async (tx) => {
      if (Object.keys(data).length) await tx.lead.update({ where: { id }, data })
      if (ownerId !== undefined) await reassignOwner(tx, current, ownerId, request.user.id)
    })
    return reply.send(serialize(await findScoped(request, id)))
  })

  // Troca rápida de responsável (painel do lead). Só gerente/admin.
  app.patch('/:id/owner', { preHandler: [requireRole('ADMIN', 'MANAGER')] }, async (request, reply) => {
    const { id } = idParam.parse(request.params)
    const { ownerId } = ownerSchema.parse(request.body)
    const current = await findScoped(request, id)
    if (ownerId && ownerId !== current.ownerId) await assertActiveUser(ownerId)
    await prisma.$transaction((tx) => reassignOwner(tx, current, ownerId, request.user.id))
    return reply.send(serialize(await findScoped(request, id)))
  })

  // Atribuição em massa (lista de leads). Só gerente/admin.
  app.patch('/bulk-owner', { preHandler: [requireRole('ADMIN', 'MANAGER')] }, async (request, reply) => {
    const { ids, ownerId } = bulkOwnerSchema.parse(request.body)
    if (ownerId) await assertActiveUser(ownerId)
    const leads = await prisma.lead.findMany({ where: { id: { in: ids } }, select: { id: true, ownerId: true } })
    let updated = 0
    await prisma.$transaction(async (tx) => {
      for (const l of leads) if (await reassignOwner(tx, l, ownerId, request.user.id)) updated++
    }, { timeout: 30_000 })
    audit('lead.bulk_owner', { count: updated, ownerId, by: request.user.id })
    return reply.send({ updated })
  })

  app.patch('/:id/stage', async (request, reply) => {
    const { id } = idParam.parse(request.params)
    const { stageId, lostReason } = stageChangeSchema.parse(request.body)
    const current = await findScoped(request, id)
    if (current.stageId === stageId) return reply.send(serialize(current))

    const target = await prisma.stage.findUnique({ where: { id: stageId } })
    if (!target) throw httpError(404, 'Etapa não encontrada')
    if (target.kind === 'LOST' && !lostReason) throw httpError(400, 'Informe o motivo da perda')

    await prisma.$transaction(async (tx) => {
      const updated = await tx.lead.update({
        where: { id },
        data: {
          stageId: target.id,
          stageChangedAt: new Date(),
          lostReason: target.kind === 'LOST' ? lostReason : null,
        },
      })
      await tx.activity.create({
        data: {
          leadId: id,
          userId: request.user.id,
          type: 'STAGE_CHANGE',
          content: `${current.stage.name} → ${target.name}${target.kind === 'LOST' ? ` · Motivo: ${lostReason}` : ''}`,
        },
      })
      // Ganho vira cliente (idempotente: reabrir e ganhar de novo não duplica).
      if (target.kind === 'WON') {
        await tx.customer.upsert({
          where: { leadId: id },
          update: {},
          create: {
            leadId: id,
            name: updated.name,
            contactName: updated.contactName,
            email: updated.email,
            phone: updated.phone,
            document: updated.document,
            mrrValue: updated.value,
          },
        })
      }
    })

    return reply.send(serialize(await findScoped(request, id)))
  })

  app.post('/:id/activities', async (request, reply) => {
    const { id } = idParam.parse(request.params)
    const input = activitySchema.parse(request.body)
    await findScoped(request, id)
    const activity = await prisma.activity.create({
      data: { leadId: id, userId: request.user.id, ...input },
      include: { user: { select: { id: true, name: true } } },
    })
    // Dá movimento ao lead na listagem (ordenada por updatedAt).
    await prisma.lead.update({ where: { id }, data: { updatedAt: new Date() } })
    return reply.status(201).send(activity)
  })

  app.delete('/:id', { preHandler: [requireRole('ADMIN', 'MANAGER')] }, async (request, reply) => {
    const { id } = idParam.parse(request.params)
    const lead = await prisma.lead.findUnique({ where: { id }, select: { id: true, name: true, customer: { select: { id: true } } } })
    if (!lead) throw httpError(404, 'Lead não encontrado')
    // Lead ganho virou cliente: excluir apagaria o cliente em cascata. Só arquivar.
    if (lead.customer) throw httpError(409, 'Este lead virou cliente e não pode ser excluído. Use "Arquivar" para tirá-lo do funil.')
    await prisma.lead.delete({ where: { id } })
    audit('lead.deleted', { leadId: id, name: lead.name, by: request.user.id })
    return reply.send({ success: true })
  })
}
