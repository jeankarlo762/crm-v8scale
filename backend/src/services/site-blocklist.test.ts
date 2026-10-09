import { describe, it, expect } from 'vitest'
import { classifyDomain, domainRelatesToBusiness, isBlockedDomain, isSocialHost } from './domain-classifier.service'
import { extractFromResults, extractSiteByHandle } from './search-enrich.service'
import { classifyPresencaDigital } from './site-classifier.service'

const loc = { city: 'Tubarão', state: 'SC' }

describe('lista de bloqueio', () => {
  it.each(['econodata.com.br', 'www.consultas.plus', 'volleybox.net', 'wanderboat.ai', 'cnpj.biz', 'guiamais.com.br', 'tripadvisor.com.br', 'x.hotelsantacatarina.com', 'g1.globo.com'])('%s é bloqueado', (h) => {
    expect(isBlockedDomain(h)).toBe(true)
    expect(classifyDomain(h)).not.toBe('candidato')
  })
  it('domínio próprio não é bloqueado', () => {
    expect(isBlockedDomain('pousadacanoaazul.com.br')).toBe(false)
  })
  it('diretório nos resultados não vira foundWebsite', () => {
    const r = extractFromResults([{ title: 'Arena Summer', url: 'https://www.econodata.com.br/empresa/arena-summer', content: 'Arena Summer Tubarão' }], 'Arena Summer', loc)
    expect(r.foundWebsite).toBeNull()
  })
})

describe('similaridade nome/@ ↔ domínio', () => {
  it('"Pousada Canoa Azul" → pousadacanoaazul.com.br passa', () => {
    expect(domainRelatesToBusiness('pousadacanoaazul.com.br', 'Pousada Canoa Azul')).toBe(true)
  })
  it('bate pelo @ do Instagram', () => {
    expect(domainRelatesToBusiness('canoaazul.com.br', 'Espaço Sol', 'canoa.azul')).toBe(true)
  })
  it('domínio sem relação não passa', () => {
    expect(domainRelatesToBusiness('minijogos.com.br', 'Arena Shark')).toBe(false)
  })
  it('sem relação é descartado; com relação e cidade fica confirmado', () => {
    const outro = extractFromResults([{ title: 'Pousada Canoa Azul', url: 'https://www.hotelbarato.com.br/x', content: 'Pousada Canoa Azul Tubarão' }], 'Pousada Canoa Azul', loc)
    expect(outro).toMatchObject({ foundWebsite: null, foundWebsiteVerificar: false })
    const ok = extractFromResults([{ title: 'Pousada Canoa Azul', url: 'https://pousadacanoaazul.com.br/', content: 'Pousada Canoa Azul Tubarão' }], 'Pousada Canoa Azul', loc)
    expect(ok).toMatchObject({ foundWebsite: 'https://pousadacanoaazul.com.br', foundWebsiteVerificar: false })
  })
  it('segunda busca por @ também descarta domínio sem relação', () => {
    const r = extractSiteByHandle([{ title: 'Canoa Azul', url: 'https://hotelbarato.com.br', content: 'Pousada Canoa Azul Tubarão' }], 'Pousada Canoa Azul', 'canoaazul', loc)
    expect(r).toBeNull()
  })
})

describe('redes sociais fora do health check', () => {
  it.each(['facebook.com', 'm.facebook.com', 'instagram.com', 'tiktok.com', 'wa.me', 'api.whatsapp.com', 'fb.watch'])('%s é rede social', (h) => {
    expect(isSocialHost(h)).toBe(true)
  })
  it('websiteUri de rede social não vira site próprio nem é testado', async () => {
    for (const url of ['https://www.facebook.com/arena', 'https://www.tiktok.com/@arena', 'https://wa.me/5548999999999']) {
      const r = await classifyPresencaDigital(url, 'Arena Teste', null)
      expect(r.status).not.toBe('site_proprio')
      expect(r.siteStatus).toBeNull()
    }
  })
  it('Facebook nos resultados da busca nunca é foundWebsite', () => {
    const r = extractFromResults([{ title: 'Arena Teste', url: 'https://www.facebook.com/arenateste', content: 'Arena Teste Tubarão' }], 'Arena Teste', loc)
    expect(r.foundWebsite).toBeNull()
  })
})
