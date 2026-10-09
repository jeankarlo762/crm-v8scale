import bcrypt from 'bcryptjs'
import { z } from 'zod'

const SALT_ROUNDS = 10

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS)
}

export function comparePassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash)
}

// Senhas que não podem ser usadas de jeito nenhum: as dos exemplos do projeto
// e as mais comuns em vazamentos. Comparação sem diferenciar maiúsculas.
const BLOCKED_PASSWORDS = new Set([
  'troque-esta-senha', 'troqueestasenha', 'changeme', 'change-me', 'password', 'senha', 'senha123',
  '12345678', '123456789', '1234567890', 'qwerty123', 'admin123', 'administrador', 'v8scale', 'v8scale123',
  'crmv8123', 'mudar123', 'abcd1234', 'password1', 'iloveyou', '11111111', '00000000', 'welcome1',
])

export const PASSWORD_MIN = 8

export function isBlockedPassword(plain: string): boolean {
  return BLOCKED_PASSWORDS.has(plain.trim().toLowerCase())
}

/** Schema Zod reutilizado em todas as rotas que recebem senha nova. */
export const newPasswordSchema = z
  .string()
  .min(PASSWORD_MIN, `A senha deve ter no mínimo ${PASSWORD_MIN} caracteres`)
  .max(128, 'Senha muito longa')
  .refine((v) => !isBlockedPassword(v), 'Essa senha é muito comum; escolha outra')
  .refine((v) => /[a-zA-Z]/.test(v) && /[0-9]/.test(v), 'Use letras e números')
