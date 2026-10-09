import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { prisma } from '../config/database'
import { authenticate, isRestricted, requireRole } from '../middlewares/auth'
import { audit } from '../utils/audit'
import { archiveCustomer, unarchiveCustomer } from '../services/customer-archive.service'
import { httpError } from '../utils/errors'
import { LIMITS, emailField, idParam, moneyField, optionalText, requiredText } from '../utils/validation'

const updateSchema = z.object({
  name: requiredText(LIMITS.short, 'Nome').optional(),
  contactName: optionalText(LIMITS.short),
  email: emailField,
  phone: optionalText(40),
  document: optionalText(40),
  mrrValue: moneyField.optional(),
  setupFee: moneyField.optional(),
  active: z.boolean().optional(),
  notes: optionalText(LIMITS.long),
})

const customerInclude = {
  lead: { select: { id: true, ownerId: true, owner: { select: { id: true, name: true } }, source: true, city: true, state: true } },
} satisfies Prisma.CustomerInclude

type CustomerWithRels = Prisma.CustomerGetPayload<{ include: typeof customerInclude }>

function serialize(c: CustomerWithRels) {
  return { ...c, mrrValue: Number(c.mrrValue), setupFee: Number(c.setupFee) }
}

export async function customerRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate)

  app.get('/', async (request, reply) => {
    const q = z.object({
      q: z.string().trim().max(LIMITS.short).optional(),
      // Padrão: só os não arquivados. archived=true lista os arquivados (módulo Clientes arquivados).
      archived: z.enum(['true', 'false']).default('false'),
    }).parse(request.query)
    const archived = q.archived === 'true'
    const where: Prisma.CustomerWhereInput = {
      archivedAt: archived ? { not: null } : null,
      ...(isRestricted(request) && { lead: { ownerId: request.user.id } }),
      ...(q.q && {
        OR: [
          { name: { contains: q.q, mode: 'insensitive' } },
          { contactName: { contains: q.q, mode: 'insensitive' } },
          { email: { contains: q.q, mode: 'insensitive' } },
          { phone: { contains: q.q } },
        ],
      }),
    }
    const customers = await prisma.customer.findMany({
      where, include: customerInclude, orderBy: archived ? { archivedAt: 'desc' } : { createdAt: 'desc' }, take: 1000,
    })
    return reply.send(customers.map(serialize))
  })

  app.patch('/:id', async (request, reply) => {
    const { id } = idParam.parse(request.params)
    const input = updateSchema.parse(request.body)
    const existing = await prisma.customer.findFirst({
      where: { id, ...(isRestricted(request) && { lead: { ownerId: request.user.id } }) },
      select: { id: true, active: true, archivedAt: true },
    })
    if (!existing) throw httpError(404, 'Cliente não encontrado')
    // Reativar um arquivado por fora do desarquivar deixaria o cliente ativo e escondido da lista.
    if (existing.archivedAt && input.active === true) throw httpError(409, 'Cliente arquivado: desarquive antes de reativar')
    // Situação da assinatura é decisão de gestão (sai do MRR): vendedor não altera.
    if (input.active !== undefined && isRestricted(request)) throw httpError(403, 'Só gerente ou administrador altera a situação do cliente')
    // churnedAt registra quando o cliente cancelou; reativar limpa a marca.
    const churn = input.active === undefined || input.active === existing.active ? {} : { churnedAt: input.active ? null : new Date() }
    const customer = await prisma.customer.update({ where: { id }, data: { ...input, ...churn }, include: customerInclude })
    return reply.send(serialize(customer))
  })

  const archiveBody = z.object({ reason: optionalText(LIMITS.long) })

  // Arquivar/desarquivar é decisão de gestão (inativa o cliente e mexe no MRR).
  app.post('/:id/archive', { preHandler: [requireRole('ADMIN', 'MANAGER')] }, async (request, reply) => {
    const { id } = idParam.parse(request.params)
    const { reason } = archiveBody.parse(request.body ?? {})
    const customer = await archiveCustomer(id, reason)
    audit('customer.archived', { customerId: id, by: request.user.id })
    return reply.send(serialize(await prisma.customer.findUniqueOrThrow({ where: { id: customer.id }, include: customerInclude })))
  })

  app.post('/:id/unarchive', { preHandler: [requireRole('ADMIN', 'MANAGER')] }, async (request, reply) => {
    const { id } = idParam.parse(request.params)
    const customer = await unarchiveCustomer(id)
    audit('customer.unarchived', { customerId: id, by: request.user.id })
    return reply.send(serialize(await prisma.customer.findUniqueOrThrow({ where: { id: customer.id }, include: customerInclude })))
  })
}
