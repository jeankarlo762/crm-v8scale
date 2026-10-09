import { describe, it, expect } from 'vitest'
import { classifyDomain, domainRelatesToBusiness, nameMatchesDomain } from './domain-classifier.service'

describe('classifyDomain', () => {
  it('reconhece linktr.ee como link_na_bio', () => {
    expect(classifyDomain('linktr.ee')).toBe('link_na_bio')
  })

  it('reconhece booking.com como plataforma', () => {
    expect(classifyDomain('booking.com')).toBe('plataforma')
  })

  it('reconhece subdomínio de plataforma com glob (*.hotelsantacatarina.com)', () => {
    expect(classifyDomain('reservas.hotelsantacatarina.com')).toBe('plataforma')
  })

  it('reconhece instagram.com como rede_social', () => {
    expect(classifyDomain('instagram.com')).toBe('rede_social')
  })

  it('ignora www. na comparação', () => {
    expect(classifyDomain('www.facebook.com')).toBe('rede_social')
  })

  it('domínio desconhecido é candidato', () => {
    expect(classifyDomain('baiukapousada.com.br')).toBe('candidato')
  })
})

describe('nameMatchesDomain — casos reais', () => {
  it('"Baiuka Pousada" bate com baiukapousada.com.br', () => {
    expect(nameMatchesDomain('Baiuka Pousada', 'baiukapousada.com.br')).toBe(true)
  })

  it('"Pousada Recanto do Mar" bate com recantodomarpousada.com.br', () => {
    expect(nameMatchesDomain('Pousada Recanto do Mar', 'recantodomarpousada.com.br')).toBe(true)
  })

  it('"Pousada Solar dos Lírios" bate com pousadasolardoslirios.com', () => {
    expect(nameMatchesDomain('Pousada Solar dos Lírios', 'pousadasolardoslirios.com')).toBe(true)
  })

  it('nome sem relação com o domínio não bate', () => {
    expect(nameMatchesDomain('Baiuka Pousada', 'outraempresaqualquer.com.br')).toBe(false)
  })
})

describe('domainRelatesToBusiness', () => {
  it('não casa atribo.com com Arena Tribo / @arenatribo (substring solta no meio da palavra)', () => {
    expect(domainRelatesToBusiness('atribo.com', 'Arena Tribo', '@arenatribo')).toBe(false)
    expect(domainRelatesToBusiness('www.atribo.com', 'Arena Tribo', 'arenatribo')).toBe(false)
  })

  it('mantém os casos legítimos', () => {
    expect(domainRelatesToBusiness('arenatribo.com.br', 'Arena Tribo', 'arenatribo')).toBe(true)
    expect(domainRelatesToBusiness('tribo.com.br', 'Arena Tribo')).toBe(true)
    expect(domainRelatesToBusiness('arenashark.com.br', 'Arena Shark', 'arenasharkoficial')).toBe(true)
    expect(domainRelatesToBusiness('pousadabaiuka.com.br', 'Baiuka Pousada')).toBe(true)
    expect(domainRelatesToBusiness('spfutsal.com.br', 'SP Futsal')).toBe(true)
  })

  it('domínio curto só bate com o @ se for o começo dele ou cobrir a maior parte', () => {
    expect(domainRelatesToBusiness('arenashark.com.br', 'Quadra X', 'arenasharkoficial')).toBe(true)
    expect(domainRelatesToBusiness('shark.com.br', 'Quadra X', 'arenasharkoficial')).toBe(false)
  })
})

describe('plataformas de agendamento de quadra', () => {
  it('bloqueia agendeiquadras e deujogo (inclui subdomínio)', () => {
    expect(classifyDomain('site.agendeiquadras.com.br')).toBe('plataforma')
    expect(classifyDomain('deujogo.com')).toBe('plataforma')
  })
})
