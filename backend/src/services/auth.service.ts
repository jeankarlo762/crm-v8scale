import { prisma } from '../config/database'
import { comparePassword, hashPassword } from '../utils/password'
import {
  signAccessToken, signRefreshToken, verifyRefreshToken, hashToken, tokenExpiry, TokenPayload,
} from '../utils/token'
import { httpError } from '../utils/errors'
import { audit } from '../utils/audit'

// Hash fixo comparado quando o e-mail não existe, para o tempo de resposta não
// revelar se a conta existe (evita enumeração de e-mails por timing).
const DUMMY_PASSWORD_HASH = '$2a$10$CwTycUXWue0Thq9StjUM0uJ8kGXOUOgHDzQOZ3fVdX5EiRZUKfjIu'

interface PublicUser { id: string; name: string; email: string; role: string }

async function issueTokens(user: PublicUser) {
  const payload: TokenPayload = { sub: user.id, role: user.role }
  const accessToken = signAccessToken(payload)
  const refreshToken = signRefreshToken(payload)
  await prisma.refreshToken.create({
    data: { userId: user.id, tokenHash: hashToken(refreshToken), expiresAt: tokenExpiry(refreshToken) },
  })
  // Limpeza oportunista de tokens vencidos do usuário.
  await prisma.refreshToken.deleteMany({ where: { userId: user.id, expiresAt: { lt: new Date() } } })
  return { accessToken, refreshToken, user }
}

export async function login(email: string, password: string, ip?: string) {
  const user = await prisma.user.findUnique({ where: { email } })

  if (!user) {
    await comparePassword(password, DUMMY_PASSWORD_HASH)
    audit('auth.login_failed', { email, ip })
    throw httpError(401, 'Credenciais inválidas')
  }
  const valid = await comparePassword(password, user.passwordHash)
  if (!valid || !user.active) {
    audit('auth.login_failed', { userId: user.id, ip })
    throw httpError(401, 'Credenciais inválidas')
  }

  audit('auth.login', { userId: user.id, ip })
  return issueTokens({ id: user.id, name: user.name, email: user.email, role: user.role })
}

export async function refresh(token: string, ip?: string) {
  let payload: TokenPayload
  try {
    payload = verifyRefreshToken(token)
  } catch {
    throw httpError(401, 'Refresh token inválido ou expirado')
  }

  // Rotação: o token usado é consumido. Se já não existe no banco, ou foi
  // revogado ou está sendo REUTILIZADO (possível roubo): nesse caso derruba
  // todas as sessões do usuário, forçando novo login em todos os dispositivos.
  const removed = await prisma.refreshToken.deleteMany({ where: { tokenHash: hashToken(token) } })
  if (removed.count === 0) {
    await prisma.refreshToken.deleteMany({ where: { userId: payload.sub } })
    audit('auth.refresh_reuse_detected', { userId: payload.sub, ip })
    throw httpError(401, 'Refresh token inválido')
  }

  const user = await prisma.user.findUnique({ where: { id: payload.sub } })
  if (!user || !user.active) throw httpError(401, 'Usuário inativo')

  const { accessToken, refreshToken } = await issueTokens({ id: user.id, name: user.name, email: user.email, role: user.role })
  return { accessToken, refreshToken }
}

export async function logout(token: string) {
  await prisma.refreshToken.deleteMany({ where: { tokenHash: hashToken(token) } })
}

export function getMe(userId: string) {
  return prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { id: true, name: true, email: true, phone: true, role: true, active: true, createdAt: true },
  })
}

export async function changePassword(userId: string, current: string, next: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } })
  if (!(await comparePassword(current, user.passwordHash))) throw httpError(400, 'Senha atual incorreta')
  await prisma.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(next) } })
  // Encerra as demais sessões após troca de senha.
  await prisma.refreshToken.deleteMany({ where: { userId } })
  audit('auth.password_changed', { userId })
}
