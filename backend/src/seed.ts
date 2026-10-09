import { PrismaClient } from '@prisma/client'
import { env } from './config/env'
import { hashPassword, isBlockedPassword } from './utils/password'

const DEFAULT_STAGES = [
  { name: 'Novo', color: '#64748b', kind: 'OPEN' },
  { name: 'Contato feito', color: '#0ea5e9', kind: 'OPEN' },
  { name: 'Qualificado', color: '#6366f1', kind: 'OPEN' },
  { name: 'Proposta enviada', color: '#f59e0b', kind: 'OPEN' },
  { name: 'Negociação', color: '#f97316', kind: 'OPEN' },
  { name: 'Ganho', color: '#16a34a', kind: 'WON' },
  { name: 'Perdido', color: '#dc2626', kind: 'LOST' },
]

/** Cria o funil padrão e o primeiro admin apenas quando o banco está vazio. */
export async function initSeedIfNeeded(prisma: PrismaClient) {
  if ((await prisma.stage.count()) === 0) {
    await prisma.stage.createMany({ data: DEFAULT_STAGES.map((s, position) => ({ ...s, position })) })
    console.log('[seed] funil padrão criado')
  }

  if ((await prisma.user.count()) === 0) {
    if (!env.SEED_ADMIN_EMAIL || !env.SEED_ADMIN_PASSWORD) {
      console.warn('[seed] nenhum usuário existe e SEED_ADMIN_EMAIL/SEED_ADMIN_PASSWORD não foram definidos — não será possível entrar')
      return
    }
    // A senha do .env.example (e outras óbvias) nunca pode virar a senha do admin.
    if (isBlockedPassword(env.SEED_ADMIN_PASSWORD)) {
      throw new Error('[seed] SEED_ADMIN_PASSWORD é a senha de exemplo ou uma senha muito comum. Defina outra antes de subir.')
    }
    await prisma.user.create({
      data: {
        name: env.SEED_ADMIN_NAME,
        email: env.SEED_ADMIN_EMAIL.toLowerCase(),
        passwordHash: await hashPassword(env.SEED_ADMIN_PASSWORD),
        role: 'ADMIN',
      },
    })
    console.log(`[seed] administrador criado: ${env.SEED_ADMIN_EMAIL}`)
  }
}
