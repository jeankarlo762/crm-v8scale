import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../config/database'
import { authenticate, requireAdmin, requireRole } from '../middlewares/auth'
import { hashPassword, newPasswordSchema } from '../utils/password'
import { httpError } from '../utils/errors'
import { audit } from '../utils/audit'
import { LIMITS, idParam, optionalText, requiredText } from '../utils/validation'

const roleEnum = z.enum(['ADMIN', 'MANAGER', 'SELLER'])

const createSchema = z.object({
  name: requiredText(LIMITS.short, 'Nome'),
  email: z.string().trim().max(LIMITS.short).email('Email inválido').transform((v) => v.toLowerCase()),
  phone: optionalText(40),
  password: newPasswordSchema,
  role: roleEnum.default('SELLER'),
})

const updateSchema = z.object({
  name: requiredText(LIMITS.short, 'Nome').optional(),
  phone: optionalText(40),
  role: roleEnum.optional(),
  active: z.boolean().optional(),
})

const resetPasswordSchema = z.object({ password: newPasswordSchema })

const publicSelect = { id: true, name: true, email: true, phone: true, role: true, active: true, createdAt: true } as const

export async function userRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate)

  // ADMIN vê todos; MANAGER só precisa dos ativos (para atribuir leads).
  app.get('/', { preHandler: [requireRole('ADMIN', 'MANAGER')] }, async (request, reply) => {
    const where = request.user.role === 'ADMIN' ? {} : { active: true }
    const users = await prisma.user.findMany({ where, select: publicSelect, orderBy: { name: 'asc' } })
    return reply.send(users)
  })

  app.post('/', { preHandler: [requireAdmin] }, async (request, reply) => {
    const input = createSchema.parse(request.body)
    const user = await prisma.user.create({
      data: {
        name: input.name,
        email: input.email,
        phone: input.phone ?? null,
        role: input.role,
        passwordHash: await hashPassword(input.password),
      },
      select: publicSelect,
    })
    audit('user.created', { userId: user.id, role: user.role, by: request.user.id })
    return reply.status(201).send(user)
  })

  app.patch('/:id', { preHandler: [requireAdmin] }, async (request, reply) => {
    const { id } = idParam.parse(request.params)
    const input = updateSchema.parse(request.body)

    // Evita o admin se trancar para fora do sistema.
    if (id === request.user.id && (input.active === false || (input.role && input.role !== 'ADMIN'))) {
      throw httpError(400, 'Você não pode desativar nem rebaixar a própria conta')
    }

    const user = await prisma.user.update({
      where: { id },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.phone !== undefined && { phone: input.phone }),
        ...(input.role !== undefined && { role: input.role }),
        ...(input.active !== undefined && { active: input.active }),
      },
      select: publicSelect,
    })
    if (input.active === false) await prisma.refreshToken.deleteMany({ where: { userId: id } })
    if (input.role !== undefined || input.active !== undefined) {
      audit('user.updated', { userId: id, role: input.role, active: input.active, by: request.user.id })
    }
    return reply.send(user)
  })

  app.post('/:id/password', { preHandler: [requireAdmin] }, async (request, reply) => {
    const { id } = idParam.parse(request.params)
    const { password } = resetPasswordSchema.parse(request.body)
    await prisma.user.update({ where: { id }, data: { passwordHash: await hashPassword(password) } })
    await prisma.refreshToken.deleteMany({ where: { userId: id } })
    audit('user.password_reset', { userId: id, by: request.user.id })
    return reply.send({ success: true })
  })
}
