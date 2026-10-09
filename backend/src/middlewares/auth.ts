import { FastifyRequest, FastifyReply } from 'fastify'
import { verifyAccessToken } from '../utils/token'
import { prisma } from '../config/database'

export type Role = 'ADMIN' | 'MANAGER' | 'SELLER'

declare module 'fastify' {
  interface FastifyRequest {
    user: { id: string; name: string; email: string; role: Role }
  }
}

// Hooks assíncronos que respondem devem retornar `reply` para encerrar a cadeia
// de forma explícita (sem depender do Fastify checar reply.sent).
export async function authenticate(request: FastifyRequest, reply: FastifyReply) {
  const header = request.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    return reply.status(401).send({ error: true, message: 'Token não fornecido', code: 'UNAUTHORIZED' })
  }

  let userId: string
  try {
    userId = verifyAccessToken(header.slice(7)).sub
  } catch {
    return reply.status(401).send({ error: true, message: 'Token inválido ou expirado', code: 'TOKEN_EXPIRED' })
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, role: true, active: true },
  })
  if (!user || !user.active) {
    return reply.status(401).send({ error: true, message: 'Usuário inativo ou não encontrado', code: 'UNAUTHORIZED' })
  }
  request.user = { id: user.id, name: user.name, email: user.email, role: user.role as Role }
  return undefined
}

export function requireRole(...roles: Role[]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!roles.includes(request.user?.role)) {
      return reply.status(403).send({ error: true, message: 'Permissão insuficiente', code: 'FORBIDDEN' })
    }
    return undefined
  }
}

export const requireAdmin = requireRole('ADMIN')

/** Vendedor só enxerga o que é dele; ADMIN e MANAGER enxergam tudo. */
export function isRestricted(request: FastifyRequest): boolean {
  return request.user.role === 'SELLER'
}
