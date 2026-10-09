import { describe, expect, it } from 'vitest'
import { isBlockedPassword, newPasswordSchema } from '../src/utils/password'

describe('política de senha (sem banco)', () => {
  it('bloqueia a senha do .env.example e variações', () => {
    expect(isBlockedPassword('troque-esta-senha')).toBe(true)
    expect(isBlockedPassword('TROQUE-ESTA-SENHA ')).toBe(true)
    expect(isBlockedPassword('12345678')).toBe(true)
    expect(isBlockedPassword('Correto#Cavalo2026')).toBe(false)
  })

  it('exige tamanho mínimo, letras e números', () => {
    expect(newPasswordSchema.safeParse('curta1').success).toBe(false)
    expect(newPasswordSchema.safeParse('somenteletras').success).toBe(false)
    expect(newPasswordSchema.safeParse('123456789012').success).toBe(false)
    expect(newPasswordSchema.safeParse('senha123').success).toBe(false) // comum
    expect(newPasswordSchema.safeParse('MinhaSenha2026').success).toBe(true)
  })
})
