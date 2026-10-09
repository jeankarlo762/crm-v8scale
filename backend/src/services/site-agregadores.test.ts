import { describe, it, expect } from 'vitest'
import { domainRelatesToBusiness, isBlockedDomain, looksLikeAggregator, registrableDomain } from './domain-classifier.service'
import { extractFromResults, type SearchResult } from './search-enrich.service'

const sc = { city: 'Gravatal', state: 'SC', address: 'Rua A, 10 - Centro, Gravatal - SC' }
const laguna = { city: 'Laguna', state: 'SC', address: 'Rua B, 20 - Mar Grosso, Laguna - SC' }
const res = (url: string, title: string, content = ''): SearchResult => ({ url, title, content })

describe('domínio registrável (tldts)', () => {
  it('extrai eTLD+1', () => {
    expect(registrableDomain('hotel-lagoa-laguna.hotels-brazil.net')).toBe('hotels-brazil.net')
    expect(registrableDomain('pousada-gravata-gravatal.ohotel.com.br')).toBe('ohotel.com.br')
  })
})

describe('similaridade só pelo domínio registrável', () => {
  it.each([
    ['hotel-lagoa-laguna.hotels-brazil.net', 'Hotel Lagoa Laguna'],
    ['pousada-gravata-gravatal.ohotel.com.br', 'Pousada Gravatá'],
    ['dalmo.hotels-brazil.net', 'Dalmo'],
    ['chaledasclarasgravatal.br-hotels.com', 'Chalé das Claras Gravatal'],
    ['flats-cheiro-do-mar-apartment.hotels-brazil.net', 'Flats Cheiro do Mar'],
    ['pousada-bella-vista-88735-000.hotelsantacatarina.net', 'Pousada Bella Vista'],
  ])('rejeita %s', (host, nome) => {
    expect(domainRelatesToBusiness(host, nome)).toBe(false)
  })
  it('aceita "Pousada Canoa Azul" → pousadacanoaazul.com.br', () => {
    expect(domainRelatesToBusiness('pousadacanoaazul.com.br', 'Pousada Canoa Azul')).toBe(true)
  })
  it('estrito: "Costa Montana" não casa com costao-da-serra', () => {
    expect(domainRelatesToBusiness('costao-da-serra.com.br', 'Costa Montana')).toBe(false)
    expect(domainRelatesToBusiness('costamontana.com.br', 'Costa Montana')).toBe(true)
  })
})

describe('heurística de agregador e blocklist ampliada', () => {
  it('genérico de viagem sem tokens do nome é agregador', () => {
    expect(looksLikeAggregator('hotels-brazil.net', 'Pousada Sol')).toBe(true)
    expect(looksLikeAggregator('viagensmelhores.com.br', 'Pousada Sol')).toBe(true)
    expect(looksLikeAggregator('hotelcanoaazul.com.br', 'Pousada Canoa Azul')).toBe(false)
    expect(looksLikeAggregator('baiuka.com.br', 'Baiuka Pousada')).toBe(false)
  })
  it.each(['planetofhotels.com', 'skyscanner.com.br', 'www.skyscanner.net', 'wego.com', 'jo.wego.com', 'hoteles.com', 'a-hotel.com', 'hotelnear.com', 'br-hotels.com', 'hotels-brazil.net', 'ohotel.com.br', 'riograndedosulhotels.net', 'hotelsantacatarina.net', 'maladeaventuras.com', 'dicasdeviagem.com', 'levenaviagem.com.br', 'bedandbreakfastt.com', 'serrasc.com.br', 'google.com.br', 'maps.google.de', 'empresas.serasaexperian.com.br', 'x.y.hotels-brazil.net'])('bloqueia %s', (h) => {
    expect(isBlockedDomain(h)).toBe(true)
  })
})

describe('descarte na extração', () => {
  it('bloqueado/sem relação não vira nem "verificar"', () => {
    const r = extractFromResults([
      res('https://pousada-sol-gravatal.hotels-brazil.net/x', 'Pousada Sol', 'Gravatal SC'),
      res('https://www.outrosite.com.br', 'Pousada Sol', 'Gravatal SC'),
    ], 'Pousada Sol', sc)
    expect(r.foundWebsite).toBeNull()
    expect(r.foundWebsiteVerificar).toBe(false)
  })
  it('relacionado sem cidade confirmada vira "verificar"', () => {
    const r = extractFromResults([res('https://pousadasol.com.br', 'Pousada Sol', 'Hospedagem')], 'Pousada Sol', sc)
    expect(r).toMatchObject({ foundWebsite: 'https://pousadasol.com.br', foundWebsiteVerificar: true })
  })
})

describe('nome que contém a cidade', () => {
  it('a cidade sozinha não confirma; SC/DDD/bairro confirmam', () => {
    const so = extractFromResults([res('https://pousadalaguna.com.br', 'Pousada Laguna', 'Ótima pousada em Laguna')], 'Pousada Laguna', laguna)
    expect(so.foundWebsiteVerificar).toBe(true)
    const uf = extractFromResults([res('https://pousadalaguna.com.br', 'Pousada Laguna', 'Laguna, Santa Catarina')], 'Pousada Laguna', laguna)
    expect(uf.foundWebsiteVerificar).toBe(false)
    const ddd = extractFromResults([res('https://pousadalaguna.com.br', 'Pousada Laguna', 'Reservas (48) 99999-1234')], 'Pousada Laguna', laguna)
    expect(ddd.foundWebsiteVerificar).toBe(false)
    const bairro = extractFromResults([res('https://pousadalaguna.com.br', 'Pousada Laguna', 'Mar Grosso')], 'Pousada Laguna', laguna)
    expect(bairro.foundWebsiteVerificar).toBe(false)
  })
  it('rejeita outro estado no domínio (pb) ou no conteúdo (Paraíba)', () => {
    expect(extractFromResults([res('https://pousadalagunapb.com.br', 'Pousada Laguna', 'Laguna')], 'Pousada Laguna', laguna).foundWebsite).toBeNull()
    expect(extractFromResults([res('https://pousadalaguna.com.br', 'Pousada Laguna', 'Pousada em Paraíba')], 'Pousada Laguna', laguna).foundWebsite).toBeNull()
  })
})
