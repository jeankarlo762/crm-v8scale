import { describe, expect, it } from 'vitest'
import { candidateStates, inferState } from '../src/services/geo-uf.service'

describe('UF do prospect', () => {
  it('usa a UF informada quando válida', () => {
    expect(inferState({ state: 'sc', city: 'Tubarão' })).toBe('SC')
  })
  it('lê os componentes de endereço do Google', () => {
    expect(inferState({ city: 'Tubarão', addressComponents: [{ types: ['administrative_area_level_1'], shortText: 'SC', longText: 'Santa Catarina' }] })).toBe('SC')
  })
  it('lê o endereço formatado', () => {
    expect(inferState({ city: 'Tubarão', address: 'R. Lauro Müller, 100 - Centro, Tubarão - SC, 88701-000, Brasil' })).toBe('SC')
    expect(inferState({ city: 'Capivari de Baixo', address: 'Av. Brasil, 5 - Capivari de Baixo - SC, 88745-000' })).toBe('SC')
  })
  it('resolve pelo nome da cidade na tabela do IBGE quando o nome é único', () => {
    expect(inferState({ city: 'Tubarão' })).toBe('SC')
    expect(inferState({ city: 'tubarao' })).toBe('SC')
    expect(inferState({ city: 'Florianópolis' })).toBe('SC')
    expect(inferState({ city: 'Uberlândia' })).toBe('MG')
    expect(inferState({ city: 'Tubarão - SC' })).toBe('SC')
  })
  it('não chuta cidade com nome repetido em várias UFs nem cidade desconhecida', () => {
    expect(inferState({ city: 'Bom Jesus' })).toBeNull()
    expect(candidateStates('Bom Jesus').length).toBeGreaterThan(1)
    expect(inferState({ city: 'Cidade Que Nao Existe' })).toBeNull()
  })
  it('endereço desempata cidade com nome repetido', () => {
    expect(inferState({ city: 'Bom Jesus', address: 'Rua A, 1 - Bom Jesus - RS, 95290-000, Brasil' })).toBe('RS')
  })
})
