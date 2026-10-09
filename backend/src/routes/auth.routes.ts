import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import * as authService from '../services/auth.service'
import { authenticate } from '../middlewares/auth'
import { prisma } from '../config/database'
import { newPasswordSchema } from '../utils/password'
import { LIMITS, optionalText, requiredText } from '../utils/validation'

// Limite rígido contra força bruta no login/refresh.
const strictLimit = { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }

const loginSchema = z.object({
  email: z.string().trim().max(LIMITS.short).email('Email inválido').transform((v) => v.toLowerCase()),
  password: z.string().min(1, 'Senha obrigatória').max(128),
})
const tokenSchema = z.object({ refreshToken: z.string().min(1, 'Refresh token obrigatório').max(2048) })
const updateMeSchema = z.object({
  name: requiredText(LIMITS.short, 'Nome'),
  phone: optionalText(40),
})
const passwordSchema = z.object({
  currentPassword: z.string().min(1, 'Senha atual obrigatória').max(128),
  newPassword: newPasswordSchema,
})

export async function authRoutes(app: FastifyInstance) {
  app.post('/login', strictLimit, async (request, reply) => {
    const { email, password } = loginSchema.parse(request.body)
    return reply.send(await authService.login(email, password, request.ip))
  })

  app.post('/refresh', strictLimit, async (request, reply) => {
    const { refreshToken } = tokenSchema.parse(request.body)
    return reply.send(await authService.refresh(refreshToken, request.ip))
  })

  app.post('/logout', strictLimit, async (request, reply) => {
    const { refreshToken } = tokenSchema.parse(request.body)
    await authService.logout(refreshToken)
    return reply.send({ success: true })
  })

  app.get('/me', { preHandler: [authenticate] }, async (request, reply) => {
    return reply.send(await authService.getMe(request.user.id))
  })

  app.patch('/me', { preHandler: [authenticate] }, async (request, reply) => {
    const input = updateMeSchema.parse(request.body)
    const user = await prisma.user.update({
      where: { id: request.user.id },
      data: { name: input.name, phone: input.phone ?? null },
      select: { id: true, name: true, email: true, phone: true, role: true, active: true, createdAt: true },
    })
    return reply.send(user)
  })

  app.post('/me/password', { ...strictLimit, preHandler: [authenticate] }, async (request, reply) => {
    const { currentPassword, newPassword } = passwordSchema.parse(request.body)
    await authService.changePassword(request.user.id, currentPassword, newPassword)
    return reply.send({ success: true })
  })
}
