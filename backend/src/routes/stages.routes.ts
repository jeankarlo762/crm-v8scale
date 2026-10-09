import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../config/database'
import { authenticate, requireAdmin } from '../middlewares/auth'
import { httpError } from '../utils/errors'
import { audit } from '../utils/audit'
import { LIMITS, idParam, requiredText } from '../utils/validation'

const colorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Cor inválida (use #RRGGBB)')

const createSchema = z.object({
  name: requiredText(LIMITS.short, 'Nome'),
  color: colorSchema.default('#64748b'),
  kind: z.enum(['OPEN', 'WON', 'LOST']).default('OPEN'),
})
const updateSchema = z.object({
  name: requiredText(LIMITS.short, 'Nome').optional(),
  color: colorSchema.optional(),
  kind: z.enum(['OPEN', 'WON', 'LOST']).optional(),
})
const reorderSchema = z.object({ ids: z.array(z.string().max(64)).min(1).max(100) })

export async function stageRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate)

  app.get('/', async (_request, reply) => {
    return reply.send(await prisma.stage.findMany({ orderBy: { position: 'asc' } }))
  })

  app.post('/', { preHandler: [requireAdmin] }, async (request, reply) => {
    const input = createSchema.parse(request.body)
    const last = await prisma.stage.findFirst({ orderBy: { position: 'desc' }, select: { position: true } })
    const stage = await prisma.stage.create({ data: { ...input, position: (last?.position ?? -1) + 1 } })
    return reply.status(201).send(stage)
  })

  // Reordenar — rota fixa declarada antes de /:id.
  app.put('/reorder', { preHandler: [requireAdmin] }, async (request, reply) => {
    const { ids } = reorderSchema.parse(request.body)
    // A lista precisa conter exatamente todas as etapas, sem repetição, senão as posições colidem.
    const existing = await prisma.stage.findMany({ select: { id: true } })
    const unique = new Set(ids)
    if (unique.size !== ids.length || unique.size !== existing.length || !existing.every((s) => unique.has(s.id))) {
      throw httpError(400, 'A lista de reordenação deve conter todas as etapas, uma vez cada')
    }
    await prisma.$transaction(ids.map((id, position) => prisma.stage.update({ where: { id }, data: { position } })))
    return reply.send(await prisma.stage.findMany({ orderBy: { position: 'asc' } }))
  })

  app.patch('/:id', { preHandler: [requireAdmin] }, async (request, reply) => {
    const { id } = idParam.parse(request.params)
    const input = updateSchema.parse(request.body)
    if (input.kind !== undefined) {
      const stage = await prisma.stage.findUnique({ where: { id }, select: { kind: true } })
      if (!stage) throw httpError(404, 'Etapa não encontrada')
      // Mudar o tipo com leads dentro deixaria leads "ganhos" sem cliente (ou vice-versa).
      if (stage.kind !== input.kind) {
        const inUse = await prisma.lead.count({ where: { stageId: id } })
        if (inUse > 0) throw httpError(409, `Esta etapa tem ${inUse} lead(s). Mova-os antes de mudar o tipo.`)
      }
    }
    return reply.send(await prisma.stage.update({ where: { id }, data: input }))
  })

  app.delete('/:id', { preHandler: [requireAdmin] }, async (request, reply) => {
    const { id } = idParam.parse(request.params)
    const inUse = await prisma.lead.count({ where: { stageId: id } })
    if (inUse > 0) throw httpError(409, `Esta etapa tem ${inUse} lead(s). Mova-os para outra etapa antes de excluir.`)
    const total = await prisma.stage.count()
    if (total <= 1) throw httpError(409, 'O funil precisa ter ao menos uma etapa')
    await prisma.stage.delete({ where: { id } })
    audit('stage.deleted', { stageId: id, by: request.user.id })
    return reply.send({ success: true })
  })
}
