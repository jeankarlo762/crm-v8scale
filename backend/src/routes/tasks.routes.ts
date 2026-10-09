import { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { prisma } from '../config/database'
import { authenticate, isRestricted } from '../middlewares/auth'
import { httpError } from '../utils/errors'
import { LIMITS, assertActiveUser, idParam, requiredText } from '../utils/validation'

const dateString = z.string().max(40).refine((v) => !Number.isNaN(new Date(v).getTime()), 'Data inválida')

const createSchema = z.object({
  title: requiredText(LIMITS.medium, 'Título'),
  dueAt: dateString,
  leadId: z.string().max(64).nullish(),
  assigneeId: z.string().max(64).nullish(),
})
const updateSchema = z.object({
  title: requiredText(LIMITS.medium, 'Título').optional(),
  dueAt: dateString.optional(),
  done: z.boolean().optional(),
  assigneeId: z.string().max(64).nullish(),
})
const listQuery = z.object({
  status: z.enum(['open', 'done', 'all']).default('open'),
  mine: z.enum(['true', 'false']).default('false'),
  leadId: z.string().max(64).optional(),
})

const taskInclude = {
  lead: { select: { id: true, name: true } },
  assignee: { select: { id: true, name: true } },
} satisfies Prisma.TaskInclude

function scope(request: FastifyRequest): Prisma.TaskWhereInput {
  return isRestricted(request) ? { assigneeId: request.user.id } : {}
}

async function findScoped(request: FastifyRequest, id: string) {
  const task = await prisma.task.findFirst({ where: { id, ...scope(request) } })
  if (!task) throw httpError(404, 'Tarefa não encontrada')
  return task
}

export async function taskRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate)

  app.get('/', async (request, reply) => {
    const q = listQuery.parse(request.query)
    const where: Prisma.TaskWhereInput = {
      ...(q.status !== 'all' && { done: q.status === 'done' }),
      ...(q.mine === 'true' && { assigneeId: request.user.id }),
      ...(q.leadId && { leadId: q.leadId }),
      ...scope(request),
    }
    const tasks = await prisma.task.findMany({
      where,
      include: taskInclude,
      orderBy: q.status === 'done' ? { doneAt: 'desc' } : { dueAt: 'asc' },
      take: 500,
    })
    return reply.send(tasks)
  })

  app.post('/', async (request, reply) => {
    const input = createSchema.parse(request.body)
    if (input.leadId) {
      const lead = await prisma.lead.findFirst({
        where: { id: input.leadId, ...(isRestricted(request) && { ownerId: request.user.id }) },
        select: { id: true },
      })
      if (!lead) throw httpError(404, 'Lead não encontrado')
    }
    const assigneeId = isRestricted(request) ? request.user.id : (input.assigneeId ?? request.user.id)
    if (assigneeId !== request.user.id) await assertActiveUser(assigneeId)
    const task = await prisma.task.create({
      data: { title: input.title, dueAt: new Date(input.dueAt), leadId: input.leadId ?? null, assigneeId },
      include: taskInclude,
    })
    return reply.status(201).send(task)
  })

  app.patch('/:id', async (request, reply) => {
    const { id } = idParam.parse(request.params)
    const input = updateSchema.parse(request.body)
    await findScoped(request, id)
    if (input.assigneeId !== undefined && isRestricted(request) && input.assigneeId !== request.user.id) {
      throw httpError(403, 'Apenas gerentes podem reatribuir tarefas')
    }
    if (input.assigneeId) await assertActiveUser(input.assigneeId)
    const task = await prisma.task.update({
      where: { id },
      data: {
        ...(input.title !== undefined && { title: input.title }),
        ...(input.dueAt !== undefined && { dueAt: new Date(input.dueAt) }),
        ...(input.assigneeId !== undefined && { assigneeId: input.assigneeId }),
        ...(input.done !== undefined && { done: input.done, doneAt: input.done ? new Date() : null }),
      },
      include: taskInclude,
    })
    return reply.send(task)
  })

  app.delete('/:id', async (request, reply) => {
    const { id } = idParam.parse(request.params)
    await findScoped(request, id)
    await prisma.task.delete({ where: { id } })
    return reply.send({ success: true })
  })
}
