import type { FastifyInstance } from 'fastify'
import { prisma } from '../src/config/database'
import { hashPassword } from '../src/utils/password'

export const HAS_DB = !!process.env.TEST_DATABASE_URL

export const PASSWORD = 'Teste#2026ok'

/** Limpa todas as tabelas (ordem respeita as FKs) e recria o funil padrão. */
export async function resetDb() {
  await prisma.task.deleteMany()
  await prisma.activity.deleteMany()
  await prisma.customer.deleteMany()
  await prisma.lead.deleteMany()
  await prisma.refreshToken.deleteMany()
  await prisma.user.deleteMany()
  await prisma.stage.deleteMany()
  await prisma.stage.createMany({
    data: [
      { name: 'Novo', kind: 'OPEN', position: 0 },
      { name: 'Proposta', kind: 'OPEN', position: 1 },
      { name: 'Ganho', kind: 'WON', position: 2 },
      { name: 'Perdido', kind: 'LOST', position: 3 },
    ],
  })
}

export async function createUser(role: 'ADMIN' | 'MANAGER' | 'SELLER', email = `${role.toLowerCase()}@test.local`) {
  return prisma.user.create({
    data: { name: `${role} Teste`, email, role, passwordHash: await hashPassword(PASSWORD) },
  })
}

export async function login(app: FastifyInstance, email: string, password = PASSWORD) {
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password } })
  return { status: res.statusCode, body: res.json() as { accessToken: string; refreshToken: string } }
}

export function bearer(token: string) {
  return { authorization: `Bearer ${token}` }
}

export async function stageByKind(kind: 'OPEN' | 'WON' | 'LOST') {
  return prisma.stage.findFirstOrThrow({ where: { kind }, orderBy: { position: 'asc' } })
}
