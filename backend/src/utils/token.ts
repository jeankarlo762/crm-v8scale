import jwt from 'jsonwebtoken'
import crypto from 'node:crypto'
import { env } from '../config/env'

// O token carrega só o necessário: quem é (sub) e o perfil no momento da emissão.
// O perfil efetivo é sempre relido do banco no middleware de autenticação.
export interface TokenPayload {
  sub: string
  role: string
}

function validatePayload(decoded: unknown): TokenPayload {
  const d = decoded as Record<string, unknown> | null
  if (typeof d !== 'object' || d === null || typeof d.sub !== 'string' || typeof d.role !== 'string') {
    throw new Error('Token inválido: payload malformado')
  }
  return { sub: d.sub, role: d.role }
}

export function signAccessToken(payload: TokenPayload): string {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'] })
}

export function signRefreshToken(payload: TokenPayload): string {
  // jti garante que dois refresh emitidos no mesmo segundo sejam diferentes.
  return jwt.sign({ ...payload, jti: crypto.randomUUID() }, env.JWT_REFRESH_SECRET, {
    expiresIn: env.JWT_REFRESH_EXPIRES_IN as jwt.SignOptions['expiresIn'],
  })
}

export function verifyAccessToken(token: string): TokenPayload {
  return validatePayload(jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] }))
}

export function verifyRefreshToken(token: string): TokenPayload {
  return validatePayload(jwt.verify(token, env.JWT_REFRESH_SECRET, { algorithms: ['HS256'] }))
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

/** Data de expiração (exp) de um JWT já assinado. */
export function tokenExpiry(token: string): Date {
  const decoded = jwt.decode(token) as { exp?: number } | null
  if (!decoded?.exp) throw new Error('Token sem exp')
  return new Date(decoded.exp * 1000)
}
