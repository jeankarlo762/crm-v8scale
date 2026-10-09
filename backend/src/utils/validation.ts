import { z } from 'zod'
import { prisma } from '../config/database'
import { httpError } from './errors'

// Limites de tamanho dos campos de texto (evita abuso de armazenamento e
// payloads absurdos). Ajuste aqui se um campo precisar de mais.
export const LIMITS = {
  short: 120, // nomes, e-mails, telefone, cidade
  medium: 300, // origem, segmento, título de tarefa, motivo de perda
  long: 5000, // observações, conteúdo de atividade
  maxMoney: 999_999_999, // R$ 999 milhões; mais que suficiente
} as const

/** Texto opcional: "" vira null; undefined continua undefined (não sobrescreve em PATCH). */
export const optionalText = (max: number) =>
  z.string().trim().max(max, `Máximo de ${max} caracteres`).nullish().transform((v) => (v === undefined ? undefined : v || null))

export const requiredText = (max: number, label = 'Campo') =>
  z.string().trim().min(1, `${label} obrigatório`).max(max, `Máximo de ${max} caracteres`)

export const emailField = z
  .union([z.string().trim().max(LIMITS.short).email('Email inválido'), z.literal(''), z.null()])
  .optional()
  .transform((v) => (v === undefined ? undefined : v || null))

export const moneyField = z.coerce
  .number()
  .finite('Valor inválido')
  .min(0, 'Valor inválido')
  .max(LIMITS.maxMoney, 'Valor acima do limite')

export const idParam = z.object({ id: z.string().min(1).max(64) })

/** Garante que o usuário referenciado (responsável de lead/tarefa) existe e está ativo. */
export async function assertActiveUser(userId: string, label = 'Responsável'): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { active: true } })
  if (!user) throw httpError(400, `${label} não encontrado`)
  if (!user.active) throw httpError(400, `${label} está inativo`)
}
