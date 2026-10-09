import { describe, it, expect } from 'vitest'
import { canonicalBrPhone, phonesInText, leadPhoneCanon, parseLeadAddress, addressInChunk, phoneFromLinkValue } from './contact-normalize'

describe('canonicalBrPhone', () => {
  it('mesmo número em formatos diferentes vira a mesma chave (+55, parênteses, 9º dígito)', () => {
    const k = '48991234567'
    for (const f of ['(48) 99123-4567', '+55 48 99123-4567', '5548991234567', '048991234567', '48 9 9123 4567']) expect(canonicalBrPhone(f)).toBe(k)
    expect(canonicalBrPhone('(48) 9123-4567')).toBe(k) // celular antigo, sem o 9
  })
  it('fixo NÃO colide com celular de mesmos 8 últimos dígitos', () => {
    expect(canonicalBrPhone('(48) 3123-4567')).toBe('4831234567')
    expect(canonicalBrPhone('(48) 3123-4567')).not.toBe(canonicalBrPhone('(48) 93123-4567'))
  })
  it('DDD diferente = número diferente', () => {
    expect(canonicalBrPhone('(48) 99123-4567')).not.toBe(canonicalBrPhone('(47) 99123-4567'))
  })
  it('rejeita o que não é telefone de contato: 0800, curtos, DDD inválido, 11 dígitos sem 9', () => {
    for (const bad of ['0800 123 4567', '12345', '(00) 99123-4567', '(48) 89123-4567x1', '48 81234567890', '']) expect(canonicalBrPhone(bad)).toBeNull()
  })
})

describe('phonesInText', () => {
  it('acha telefones formatados e ignora dígitos soltos (CNPJ, CEP, IDs)', () => {
    const t = 'CNPJ 12345678000190 CEP 88700-000 pedido 4899123456789 Ligue (48) 99123-4567 ou 48 3333-4444'
    expect([...phonesInText(t)].sort()).toEqual(['4833334444', '48991234567'])
  })
  it('phoneFromLinkValue aceita dígitos corridos (contexto tel:/wa.me já diz que é telefone)', () => {
    expect(phoneFromLinkValue('+5548991234567')).toBe('48991234567')
    expect(phoneFromLinkValue('%2B55%2048%2099123-4567')).toBe('48991234567')
  })
  it('leadPhoneCanon só casa telefone BR (E.164 estrangeiro não casa com site brasileiro)', () => {
    expect(leadPhoneCanon({ phoneE164: '+5548991234567' })).toBe('48991234567')
    expect(leadPhoneCanon({ phoneE164: '+5491155551234' })).toBeNull()
    expect(leadPhoneCanon({ whatsapp: '(48) 99123-4567' })).toBe('48991234567')
  })
})

describe('endereço', () => {
  const lead = parseLeadAddress('R. das Flores, 123 - Centro, Tubarão - SC, 88700-000, Brasil')
  it('extrai rua sem o tipo, número e CEP; abreviações não atrapalham', () => {
    expect(lead).toMatchObject({ street: 'das flores', number: '123', cep: '88700000' })
    expect(addressInChunk(lead, 'Rua das Flores, nº 123 — Tubarão/SC')).toBe(true)
    expect(addressInChunk(lead, 'Av. das Flores 123, CEP 88700-000')).toBe(true)
  })
  it('exige rua + número + âncora (cidade/CEP/bairro): sem número ou sem âncora não casa', () => {
    expect(addressInChunk(lead, 'Rua das Flores, Tubarão')).toBe(false)
    expect(addressInChunk(lead, 'Rua das Flores, 124 - Tubarão')).toBe(false)
    expect(addressInChunk(lead, 'Rua das Flores, 123')).toBe(false)
    expect(addressInChunk(lead, 'Rua das Flores, 123 - Laguna')).toBe(false)
  })
  it('usa addressComponents quando existem', () => {
    const a = parseLeadAddress(null, [{ longText: 'Rua das Flores', types: ['route'] }, { longText: '123', types: ['street_number'] }, { longText: 'Tubarão', types: ['locality'] }, { longText: '88700-000', types: ['postal_code'] }])
    expect(addressInChunk(a, 'rua das flores 123 tubarao')).toBe(true)
  })
  it('rua curtíssima não identifica ninguém', () => {
    expect(parseLeadAddress('R. Um, 5 - Centro').street).toBeNull()
  })
})
