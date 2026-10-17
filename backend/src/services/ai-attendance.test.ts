import { describe, expect, it } from 'vitest'
import { EMPTY_QUALIFICATION, parseAiTurn } from './ai-attendance.service'

describe('parseAiTurn', () => {
  it('lê o JSON mesmo com texto ao redor e mantém o que já se sabia', () => {
    const prev = { ...EMPTY_QUALIFICATION, interest: 'Onix 2020' }
    const raw = 'Claro!\n{"reply":"Temos sim! Qual seu orçamento?","interest":null,"budget":"R$ 60 mil","ready":false}'
    const r = parseAiTurn(raw, prev)
    expect(r?.reply).toBe('Temos sim! Qual seu orçamento?')
    expect(r?.qualification.interest).toBe('Onix 2020')
    expect(r?.qualification.budget).toBe('R$ 60 mil')
    expect(r?.qualification.ready).toBe(false)
  })

  it('ready nunca volta para false depois de true', () => {
    const r = parseAiTurn('{"reply":"ok","ready":false}', { ...EMPTY_QUALIFICATION, ready: true })
    expect(r?.qualification.ready).toBe(true)
  })

  it('rejeita resposta sem reply ou sem JSON', () => {
    expect(parseAiTurn('sem json', EMPTY_QUALIFICATION)).toBeNull()
    expect(parseAiTurn('{"interest":"x"}', EMPTY_QUALIFICATION)).toBeNull()
  })
})
