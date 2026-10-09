import { describe, it, expect } from 'vitest'
import { classifyUrl, normalizeUrl, siteKeyOf, candidateBase, sharedSlugOf, isCandidateSiteKind } from './url-classify.service'
import { rejectFoundSite } from './found-site-rules.service'

describe('classifyUrl / normalizeUrl', () => {
  it('Instagram, Linktree, WhatsApp, diretório e marketplace não são site de empresa', () => {
    expect(classifyUrl('https://instagram.com/empresa').kind).toBe('INSTAGRAM')
    expect(classifyUrl('https://linktr.ee/empresa').kind).toBe('LINK_IN_BIO')
    expect(classifyUrl('wa.me/5548991031021').kind).toBe('WHATSAPP')
    expect(classifyUrl('https://www.booking.com/hotel/br/x.html').kind).toBe('BOOKING_PLATFORM')
    expect(classifyUrl('https://www.ifood.com.br/delivery/x').kind).toBe('MARKETPLACE')
    expect(isCandidateSiteKind(classifyUrl('https://www.tripadvisor.com.br/Restaurant_Review-x.html').kind)).toBe(false)
  })
  it('domínio próprio é CANDIDATO a site (tipo), sem afirmar que pertence ao lead', () => {
    expect(classifyUrl('https://arenatribo.com.br').kind).toBe('OWN_WEBSITE')
  })
  it('normaliza www, barra final e tracking', () => {
    expect(normalizeUrl('HTTPS://WWW.Arena.com.br/?utm_source=x&fbclid=1#top')?.url).toBe('https://arena.com.br')
    expect(normalizeUrl('arena.com.br/loja/?a=1')?.url).toBe('https://arena.com.br/loja?a=1')
  })
})

describe('plataformas compartilhadas: o subdomínio/caminho identifica o negócio, não o domínio registrável', () => {
  it('subdomínio de construtor é site de empresa em plataforma compartilhada, com chave própria', () => {
    const a = classifyUrl('https://arenatribo.wixsite.com/inicio')
    expect(a.kind).toBe('SHARED_PLATFORM_SITE')
    expect(isCandidateSiteKind(a.kind)).toBe(true)
    expect(siteKeyOf('https://arenatribo.wixsite.com/inicio')).toBe('arenatribo.wixsite.com/inicio') // o 1º segmento identifica o site no Wix
    expect(siteKeyOf('https://outraarena.wixsite.com')).toBe('outraarena.wixsite.com')
    expect(siteKeyOf('https://arenatribo.wixsite.com')).not.toBe(siteKeyOf('https://outraarena.wixsite.com'))
    expect(sharedSlugOf('https://arenatribo.wixsite.com')).toBe('arenatribo')
  })
  it('/site/arenatribo e /site/outraarena no mesmo domínio são empresas DIFERENTES', () => {
    const a = siteKeyOf('https://plataforma.com.br/site/arenatribo?utm_source=x')
    const b = siteKeyOf('https://plataforma.com.br/site/outraarena')
    expect(a).toBe('plataforma.com.br/site/arenatribo')
    expect(b).toBe('plataforma.com.br/site/outraarena')
    expect(a).not.toBe(b)
    expect(candidateBase('https://plataforma.com.br/site/arenatribo/reservas')).toBe('https://plataforma.com.br/site/arenatribo')
    expect(sharedSlugOf('https://plataforma.com.br/site/arenatribo')).toBe('arenatribo')
  })
  it('domínio próprio: subdomínio de reservas e caminhos compartilham a chave do site (não é outro site)', () => {
    expect(siteKeyOf('https://reservas.arenatribo.com.br/agenda')).toBe(siteKeyOf('https://www.arenatribo.com.br/'))
    expect(candidateBase('https://www.arenatribo.com.br/quadras/beach')).toBe('https://arenatribo.com.br')
  })
  it('Google Sites usa o caminho /view/<nome>', () => {
    expect(siteKeyOf('https://sites.google.com/view/arena-tribo/home')).toBe('sites.google.com/view/arena-tribo')
  })
  it('regra de aceitação: outra empresa na MESMA plataforma não é "mesmo site do Google" nem "sem relação" por causa do domínio', () => {
    const lead = { arenaName: 'Arena Tribo', city: 'Tubarão', state: 'SC', website: 'https://outraarena.wixsite.com' }
    expect(rejectFoundSite('https://arenatribo.wixsite.com', lead)).toBeNull()
    expect(rejectFoundSite('https://outraarena.wixsite.com', lead)).toBe('mesmo_site_google')
    expect(rejectFoundSite('https://hotelbeta.wixsite.com', lead)).toBe('sem_relacao')
  })
})

describe('normalização específica por plataforma compartilhada (host E caminho quando identificam o negócio)', () => {
  it('Wix: dois sites no MESMO host com caminhos diferentes são negócios diferentes; páginas internas ficam sob o mesmo site', () => {
    const a = siteKeyOf('https://usuario.wixsite.com/clinica-a')
    const b = siteKeyOf('https://usuario.wixsite.com/clinica-b')
    expect(a).toBe('usuario.wixsite.com/clinica-a')
    expect(b).toBe('usuario.wixsite.com/clinica-b')
    expect(a).not.toBe(b)
    expect(siteKeyOf('https://usuario.wixsite.com/clinica-a/contato?utm_source=ig')).toBe(a)
    expect(siteKeyOf('https://USUARIO.wixsite.com/Clinica-A/')).toBe(a)
    expect(classifyUrl('https://usuario.wixsite.com/clinica-a').kind).toBe('SHARED_PLATFORM_SITE')
    expect(sharedSlugOf('https://usuario.wixsite.com/clinica-b')).toBe('clinica-b')
  })
  it('candidateBase não reduz o candidato à raiz errada: preserva o caminho que identifica o negócio e remove só o tracking', () => {
    expect(candidateBase('https://usuario.wixsite.com/clinica-a/contato?utm_campaign=x&fbclid=1')).toBe('https://usuario.wixsite.com/clinica-a')
    expect(candidateBase('https://usuario.wixsite.com/clinica-b')).toBe('https://usuario.wixsite.com/clinica-b')
    expect(candidateBase('https://sites.google.com/view/clinica-a/home?hl=pt')).toBe('https://sites.google.com/view/clinica-a')
  })
  it('Google Sites: /view/<negócio>, /site/<negócio> (clássico) e /a/<domínio>/<negócio> são sites diferentes', () => {
    expect(siteKeyOf('https://sites.google.com/view/clinica-a')).not.toBe(siteKeyOf('https://sites.google.com/view/clinica-b'))
    expect(siteKeyOf('https://sites.google.com/site/clinicaa/home')).toBe('sites.google.com/site/clinicaa')
    expect(siteKeyOf('https://sites.google.com/site/clinicab')).not.toBe(siteKeyOf('https://sites.google.com/site/clinicaa'))
    expect(siteKeyOf('https://sites.google.com/a/dominio.com/clinica-a/inicio')).toBe('sites.google.com/a/dominio.com/clinica-a')
  })
  it('plataforma por /site/<negócio> e por subdomínio (Weebly): chave própria; só tracking conhecido sai da URL', () => {
    expect(siteKeyOf('https://plataforma.com.br/site/clinicaa/contato')).toBe('plataforma.com.br/site/clinicaa')
    expect(siteKeyOf('https://clinicaa.weebly.com/contato')).toBe('clinicaa.weebly.com')
    expect(siteKeyOf('https://clinicab.weebly.com')).not.toBe(siteKeyOf('https://clinicaa.weebly.com'))
    expect(classifyUrl('https://usuario.wixsite.com/clinica-a/servicos?utm_source=x&aba=2&gclid=9').url).toBe('https://usuario.wixsite.com/clinica-a/servicos?aba=2')
  })
})
