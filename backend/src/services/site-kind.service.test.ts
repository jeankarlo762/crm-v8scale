import { describe, it, expect } from 'vitest'
import { classifySite, extractInstagramHandle } from './site-kind.service'

describe('classifySite', () => {
  it.each([
    [null, 'sem_site'],
    ['', 'sem_site'],
    ['https://www.instagram.com/baiuka.pousada/', 'so_instagram'],
    ['https://facebook.com/baiuka', 'so_facebook'],
    ['https://fb.com/baiuka', 'so_facebook'],
    ['https://wa.me/5548999999999', 'link_bio'],
    ['https://api.whatsapp.com/send?phone=5548999999999', 'link_bio'],
    ['https://linktr.ee/baiuka', 'link_bio'],
    ['https://bio.link/baiuka', 'link_bio'],
    ['https://beacons.ai/baiuka', 'link_bio'],
    ['https://www.booking.com/hotel/br/baiuka.html', 'so_ota'],
    ['https://www.airbnb.com.br/rooms/123', 'so_ota'],
    ['https://www.expedia.com.br/x', 'so_ota'],
    ['https://www.trivago.com.br/x', 'so_ota'],
    ['https://www.decolar.com/x', 'so_ota'],
    ['https://baiukapousada.com.br', 'site_proprio'],
    ['baiukapousada.com.br', 'site_proprio'],
  ])('%s -> %s', (uri, kind) => {
    expect(classifySite(uri).kind).toBe(kind)
  })

  it('extrai o @ quando é Instagram', () => {
    expect(classifySite('https://www.instagram.com/baiuka.pousada/?hl=pt-br')).toEqual({ kind: 'so_instagram', instagramHandle: 'baiuka.pousada' })
  })
})

describe('extractInstagramHandle', () => {
  it('ignora /p/, /reel/, /explore/ e /popular/', () => {
    for (const path of ['p/Cxyz', 'reel/Cxyz', 'explore/tags/x', 'popular/x']) {
      expect(extractInstagramHandle(`https://instagram.com/${path}`)).toBeNull()
    }
  })
  it('retorna null para outros domínios', () => {
    expect(extractInstagramHandle('https://facebook.com/x')).toBeNull()
  })
})
