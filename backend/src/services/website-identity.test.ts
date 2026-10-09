import { describe, it, expect } from 'vitest'
import { extractPageFacts } from './page-facts.service'
import { matchIdentity, type IdentityLead } from './website-identity.service'

const lead: IdentityLead = {
  arenaName: 'Arena Tribo', city: 'Tubarão', state: 'SC', address: 'R. das Flores, 123 - Centro, Tubarão - SC, 88700-000, Brasil',
  phoneE164: '+5548991234567', instagramHandle: 'arenatribo', instagramConfirmed: true,
}
const filler = '<p>' + 'Quadras de beach tennis, futevôlei e vôlei de areia para toda a família, aulas e torneios o ano todo. '.repeat(4) + '</p>'
const page = (body: string, title = 'Arena Tribo | Beach Tennis', over: Record<string, unknown> = {}) =>
  extractPageFacts({ url: 'https://arenatribo.com.br', finalUrl: 'https://arenatribo.com.br', httpStatus: 200, html: `<html><head><title>${title}</title></head><body>${filler}${body}</body></html>`, ...over })
const id = (body: string, title?: string, l: Partial<IdentityLead> = {}) => matchIdentity({ ...lead, ...l }, page(body, title))

describe('vínculo: confirmação exige combinação forte', () => {
  it('telefone exato em tel: + nome → CONFIRMED', () => {
    const r = id('<a href="tel:+5548991234567">ligue</a>')
    expect(r.linkage).toBe('CONFIRMED')
    expect(r.evidence.map((e) => e.type)).toContain('PHONE_MATCH_BUSINESS')
  })
  it('telefone em seção de contato (rodapé) + nome → CONFIRMED', () => {
    expect(id('<footer>Contato: (48) 99123-4567</footer>').linkage).toBe('CONFIRMED')
  })
  it('endereço completo (JSON-LD) + nome → CONFIRMED', () => {
    const ld = '<script type="application/ld+json">{"@type":"SportsActivityLocation","name":"Arena Tribo","address":{"streetAddress":"Rua das Flores, 123","addressLocality":"Tubarão","postalCode":"88700-000"}}</script>'
    const r = id(ld)
    expect(r.linkage).toBe('CONFIRMED')
    expect(r.evidence.map((e) => e.type)).toContain('ADDRESS_MATCH')
  })
  it('link exato para o Instagram CONFIRMADO + nome → CONFIRMED; @ só sugerido (verificar) não vale', () => {
    const html = '<a href="https://instagram.com/arenatribo">ig</a>'
    expect(id(html).linkage).toBe('CONFIRMED')
    expect(id(html, undefined, { instagramConfirmed: false }).linkage).not.toBe('CONFIRMED')
  })
  it('dois sinais fortes independentes confirmam mesmo sem o nome no título', () => {
    const r = id('<a href="tel:+5548991234567">x</a><a href="https://instagram.com/arenatribo">ig</a>', 'Início')
    expect(r.linkage).toBe('CONFIRMED')
  })

  it('nome + cidade + domínio parecido (sinais fracos e correlacionados) NÃO confirmam', () => {
    const r = id('<p>Tubarão, SC</p>')
    expect(r.linkage).toBe('PLAUSIBLE')
    expect(r.evidence.map((e) => e.type)).toEqual(expect.arrayContaining(['NAME_IN_IDENTITY', 'CITY_IN_PAGE', 'DOMAIN_NAME_SIMILAR']))
  })
  it('só o nome no texto, sem nada mais → INCONCLUSIVE', () => {
    expect(id('<p>Ontem jogamos na Arena Tribo com os amigos.</p>', 'Blog de esportes').linkage).toBe('INCONCLUSIVE')
  })

  it('telefone achado só em CONTEÚDO GENÉRICO não confirma (registrado e ignorado)', () => {
    const r = id('<p>Anúncio patrocinado: (48) 99123-4567 compre já!</p>', 'Notícias da cidade')
    expect(r.linkage).not.toBe('CONFIRMED')
    expect(r.evidence.map((e) => e.type)).toContain('PHONE_ONLY_IN_GENERIC_CONTENT_IGNORED')
  })
  it('telefone exato sem o nome → PLAUSIBLE (precisa da combinação)', () => {
    expect(id('<a href="tel:+5548991234567">x</a>', 'Quadras da cidade').linkage).toBe('PLAUSIBLE')
  })

  it('telefone compartilhado entre negócios exige o nome na identidade da página, não solto no texto', () => {
    const body = '<a href="tel:+5548991234567">x</a><p>Parceria com a Arena Tribo.</p>'
    expect(id(body, 'Quadras do Sul', { phoneShared: true }).linkage).not.toBe('CONFIRMED')
    // nome na identidade + telefone, mas telefone compartilhado e nada diz QUAL unidade: não confirma (ver bloco de unidades abaixo)
    expect(id(body, 'Arena Tribo', { phoneShared: true }).linkage).toBe('PLAUSIBLE')
    expect(id(body + '<footer>Endereço: Rua das Flores, Tubarão - SC</footer>', 'Arena Tribo', { phoneShared: true }).linkage).toBe('CONFIRMED')
  })
  it('página de várias empresas (diretório) com o telefone na lista não confirma sozinha', () => {
    const list = Array.from({ length: 7 }, (_, i) => `<li>Empresa ${i} - telefone: (48) 9${i}111-22${i}3</li>`).join('') + '<li>Arena Tribo - telefone: (48) 99123-4567</li>'
    const r = id(`<ul>${list}</ul>`, 'Guia de esportes')
    expect(r.linkage).not.toBe('CONFIRMED')
    expect(r.evidence.map((e) => e.type)).toContain('PHONE_MATCH_MULTI_BUSINESS_PAGE')
  })
})

describe('ausência de evidência ≠ contradição', () => {
  it('telefone não encontrado: INCONCLUSIVE (pode haver outro número)', () => {
    const r = id('<a href="tel:+554833334444">x</a>')
    expect(r.linkage).toBe('PLAUSIBLE') // nome na identidade + nenhum sinal contrário
    expect(r.evidence.map((e) => e.type)).toContain('PHONE_DIFFERENT')
    expect(r.linkage).not.toBe('CONTRADICTED')
  })
  it('página sem o nome: INCONCLUSIVE, nunca contradita', () => {
    expect(id('<p>Bem-vindo</p>', 'Home').linkage).toBe('INCONCLUSIVE')
  })
  it('HTTP 403 / anti-bot: NOT_EVALUABLE', () => {
    const f = extractPageFacts({ url: 'https://arenatribo.com.br', finalUrl: 'https://arenatribo.com.br', html: '', httpStatus: 403, blocked: true })
    expect(matchIdentity(lead, f).linkage).toBe('NOT_EVALUABLE')
  })
  it('HTML sem conteúdo útil (SPA): NOT_EVALUABLE', () => {
    const f = extractPageFacts({ url: 'https://arenatribo.com.br', finalUrl: 'https://arenatribo.com.br', httpStatus: 200, html: '<html><body><div id="app"></div></body></html>' })
    expect(matchIdentity(lead, f).linkage).toBe('NOT_EVALUABLE')
  })
})

describe('homônimos, outras empresas e outras unidades', () => {
  const ld = (name: string, city: string, tel: string) => `<script type="application/ld+json">{"@type":"LocalBusiness","name":"${name}","telephone":"${tel}","address":{"streetAddress":"Av. Central, 10","addressLocality":"${city}","addressRegion":"SC"}}</script><a href="tel:${tel}">x</a>`

  it('mesmo nome em OUTRA cidade, outro telefone: outra unidade da marca → BRAND_OTHER_UNIT (investigar), não confirma nem contradiz', () => {
    const r = id(ld('Arena Tribo', 'Florianópolis', '+554832221111'))
    expect(r.linkage).toBe('BRAND_OTHER_UNIT')
  })
  it('estruturado com OUTRA empresa (nome e telefone diferentes) → CONTRADICTED', () => {
    const r = id(ld('Hotel Beta Palace', 'Tubarão', '+554832221111'), 'Hotel Beta Palace')
    expect(r.linkage).toBe('CONTRADICTED')
    expect(r.evidence.map((e) => e.type)).toContain('OTHER_COMPANY_STRUCTURED_DATA')
  })
  it('homônimo na mesma cidade com outro telefone: nunca CONFIRMED só pelo nome', () => {
    const r = id('<a href="tel:+554832221111">x</a>')
    expect(r.linkage).not.toBe('CONFIRMED')
  })
  it('telefone bate mas o nome do estruturado é outro (telefone compartilhado/mudança de marca): INCONCLUSIVE, sem confirmar', () => {
    const r = id(ld('Quadras do Sul', 'Tubarão', '+5548991234567'), 'Quadras do Sul')
    expect(r.linkage).toBe('INCONCLUSIVE')
    expect(r.evidence.map((e) => e.type)).toContain('PHONE_MATCH_OTHER_NAME')
  })
})

describe('nomes só com palavras genéricas e acentos', () => {
  it('"Arena Hotel" (só genéricas) usa todas as palavras; acentos e caixa são normalizados', () => {
    const r = matchIdentity({ ...lead, arenaName: 'Pousada São João' }, page('<a href="tel:+5548991234567">x</a>', 'POUSADA SAO JOAO - Reservas'))
    expect(r.linkage).toBe('CONFIRMED')
  })
  it('nome de um token curto casa só como palavra inteira ("tribo" ≠ "atribos")', () => {
    const r = id('<a href="tel:+5548991234567">x</a>', 'Atribos e Tribunais')
    expect(r.linkage).toBe('PLAUSIBLE') // telefone sem o nome
  })
})

const unitLd = (units: { city: string; street?: string; tel?: string }[], name = 'Arena Tribo') =>
  units.map((u) => `<script type="application/ld+json">{"@type":"SportsActivityLocation","name":"${name}","telephone":"${u.tel ?? ''}","address":{"streetAddress":"${u.street ?? 'Av. Central, 10'}","addressLocality":"${u.city}","addressRegion":"SC"}}</script>`).join('')

describe('franquias, filiais e sinais compartilhados: contradição de unidade vem ANTES de confirmar', () => {
  const central = '<a href="tel:+5548991234567">central</a><a href="https://instagram.com/arenatribo">insta</a>'

  it('telefone central + @ da marca + nome, mas os dados estruturados são de OUTRA unidade → BRAND_OTHER_UNIT, nunca CONFIRMED', () => {
    const r = id(central + unitLd([{ city: 'Florianópolis' }]))
    expect(r.linkage).toBe('BRAND_OTHER_UNIT')
    expect(r.evidence.map((e) => e.type)).toContain('SAME_BRAND_OTHER_CITY')
  })

  it('site institucional que lista VÁRIAS unidades, sem a unidade do lead: não confirma e também não rejeita (outro município ≠ contradição)', () => {
    const r = id(central + unitLd([{ city: 'Florianópolis' }, { city: 'Joinville' }]))
    expect(r.linkage).toBe('BRAND_OTHER_UNIT')
    expect(r.linkage).not.toBe('CONTRADICTED')
  })

  it('site institucional que lista várias unidades E comprova a do lead (cidade/endereço da unidade procurada) → CONFIRMED', () => {
    const r = id(central + unitLd([{ city: 'Florianópolis' }, { city: 'Tubarão', street: 'Rua das Flores, 123' }, { city: 'Joinville' }]))
    expect(r.linkage).toBe('CONFIRMED')
  })

  it('a unidade correta é comprovada pelo ENDEREÇO mesmo quando só outra cidade está nos dados estruturados', () => {
    const r = id(central + unitLd([{ city: 'Florianópolis' }]) + '<footer>Unidade Tubarão: R. das Flores, 123 - Centro, Tubarão - SC, 88700-000</footer>')
    expect(r.linkage).toBe('CONFIRMED')
  })

  it('um único outro município SEM o nome continua contradizendo (é outra empresa)', () => {
    const r = matchIdentity(lead, page(unitLd([{ city: 'Florianópolis' }], 'Quadras do Sul'), 'Quadras do Sul'))
    expect(r.linkage).toBe('CONTRADICTED')
  })
})

describe('página com várias empresas: sinais só valem associados ao MESMO estabelecimento', () => {
  const dir = (extra: string) => Array.from({ length: 6 }, (_, i) => `<li>Empresa ${i} - telefone: (48) 9${i}111-22${i}3</li>`).join('') + extra

  it('nome do lead num bloco e telefone/endereço de outra empresa em outro: não mistura sinais', () => {
    const body = `<ul>${dir('')}</ul><h2>Arena Tribo</h2>` +
      unitLd([{ city: 'Tubarão', street: 'Rua das Flores, 123', tel: '+5548991234567' }], 'Clube Outro Nome') // telefone+endereço do lead no bloco de OUTRA empresa
    const r = matchIdentity(lead, page(body, 'Guia de esportes de SC'))
    expect(r.linkage).not.toBe('CONFIRMED')
  })

  it('nome + telefone na MESMA entidade estruturada de uma página multiempresa → vale', () => {
    const body = `<ul>${dir('')}</ul>` + unitLd([{ city: 'Tubarão', street: 'Rua das Flores, 123', tel: '+5548991234567' }, { city: 'Imbituba', tel: '+554832221111' }], 'Arena Tribo')
    const r = matchIdentity(lead, page(body, 'Guia de esportes de SC'))
    expect(r.linkage).toBe('CONFIRMED')
    expect(r.evidence.map((e) => e.type)).toContain('PHONE_MATCH_SAME_ENTITY')
  })

  it('link de Instagram solto em diretório não confirma estabelecimento', () => {
    const r = matchIdentity(lead, page(`<ul>${dir('<li>Arena Tribo</li>')}</ul><a href="https://instagram.com/arenatribo">ig</a>`, 'Guia de esportes de SC'))
    expect(r.linkage).not.toBe('CONFIRMED')
  })
})

describe('unidade comprovada também pelo TEXTO VISÍVEL (sem JSON-LD)', () => {
  const central = '<a href="tel:+5548991234567">central</a><a href="https://instagram.com/arenatribo">insta</a>'
  const foot = (t: string) => `<footer>Endereço e contato: ${t}</footer>`

  it('telefone compartilhado + nome, sem nenhuma pista da unidade → PLAUSIBLE (UNKNOWN), com a evidência registrada', () => {
    const r = id(central, 'Arena Tribo', { phoneShared: true })
    expect(r.linkage).toBe('PLAUSIBLE')
    expect(r.evidence.map((e) => e.type)).toContain('SHARED_CONTACT_WITHOUT_UNIT_PROOF')
  })
  it('@ compartilhado (perfil da marca) + nome + link: não confirma sem a unidade', () => {
    const r = id('<a href="https://instagram.com/arenatribo">insta</a>', 'Arena Tribo', { instagramShared: true, phoneE164: null })
    expect(r.linkage).not.toBe('CONFIRMED')
  })
  it('rodapé visível cita só OUTRA unidade ("Florianópolis - SC") com telefone/@ centrais → BRAND_OTHER_UNIT, mesmo sem JSON-LD', () => {
    const r = id(central + foot('Unidade Florianópolis - SC, Rua X, 10'), 'Arena Tribo', { phoneShared: true, instagramShared: true })
    expect(r.linkage).toBe('BRAND_OTHER_UNIT')
    expect(id(central + foot('Unidade Florianópolis - SC'), 'Arena Tribo').linkage).toBe('BRAND_OTHER_UNIT') // sem flag de compartilhamento também
  })
  it('texto visível lista várias unidades e inclui a do lead → CONFIRMED', () => {
    const r = id(central + foot('Florianópolis - SC | Tubarão - SC | Joinville - SC'), 'Arena Tribo', { phoneShared: true })
    expect(r.linkage).toBe('CONFIRMED')
  })
  it('texto visível lista várias unidades SEM a do lead → BRAND_OTHER_UNIT (não rejeita, não confirma)', () => {
    const r = id(central + foot('Florianópolis/SC e Joinville/SC'), 'Arena Tribo', { phoneShared: true })
    expect(r.linkage).toBe('BRAND_OTHER_UNIT')
  })
  it('endereço completo do lead continua sendo prova suficiente da unidade mesmo com telefone compartilhado', () => {
    const r = id(central + foot('R. das Flores, 123 - Centro, Tubarão - SC, 88700-000'), 'Arena Tribo', { phoneShared: true })
    expect(r.linkage).toBe('CONFIRMED')
  })
})
