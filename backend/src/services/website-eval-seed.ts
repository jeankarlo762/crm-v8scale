// Conjunto de exemplos rotulados SINTÉTICOS (escritos à mão a partir dos casos de erro conhecidos). Servem para provar que a
// rotina de avaliação roda e como regressão do classificador; NÃO medem desempenho real. Para medir de verdade, exporte uma
// amostra da base (prisma/eval-website-decision.ts --export-sample) e rotule `truth` à mão.
import type { EvalCase } from './website-eval.service'
import type { ResolveLead } from './website-resolve.service'
import type { WebsiteStatus } from './website-types'

const L: ResolveLead = {
  arenaName: 'Arena Tribo', city: 'Tubarão', state: 'SC', address: 'R. das Flores, 123 - Centro, Tubarão - SC, 88700-000, Brasil',
  phoneE164: '+5548991234567', whatsapp: '(48) 99123-4567', placeId: 'seed', website: null, foundWebsite: null,
  instagramHandle: null, instagramVerificar: false, instagramManual: false, siteManual: false,
}
const filler = '<p>' + 'Quadras de beach tennis, futevôlei e vôlei de areia para toda a família, aulas e torneios o ano todo. '.repeat(4) + '</p>'
const page = (title: string, body = '', ld = '') => `<html><head><title>${title}</title>${ld}</head><body>${filler}${body}</body></html>`
const ld = (name: string, city: string, tel: string) => `<script type="application/ld+json">{"@type":"LocalBusiness","name":"${name}","telephone":"${tel}","address":{"streetAddress":"Av. Central, 10","addressLocality":"${city}","addressRegion":"SC"}}</script>`
const OWN = page('Arena Tribo | Beach Tennis', '<a href="tel:+5548991234567">ligue</a>')
const OTHER = page('Hotel Beta Palace', '<a href="tel:+554832221111">x</a>', ld('Hotel Beta Palace', 'Tubarão', '+554832221111'))
const G = { google: true as const }
const NAME_EMPTY = { search: 'NAME' as const }
const PHONE_EMPTY = { search: 'PHONE' as const }
const hit = (url: string, title = 'Arena Tribo') => ({ title, url, content: 'Arena Tribo em Tubarão SC, quadras de beach tennis' })

export type SeedCase = EvalCase & { expectStatus: WebsiteStatus }

export const SEED_CASES: SeedCase[] = [
  { id: 'google-confirmado', synthetic: true, note: 'site do Google com telefone + nome', lead: { ...L, website: 'https://arenatribo.com.br' }, rows: [G, { page: 'https://arenatribo.com.br', html: OWN }], truth: 'HAS_WEBSITE', expectStatus: 'HAS_WEBSITE' },
  { id: 'google-dominio-errado', synthetic: true, note: 'websiteUri aponta p/ outra empresa', lead: { ...L, website: 'https://hotelbeta.com.br' }, rows: [G, { page: 'https://hotelbeta.com.br', html: OTHER }, NAME_EMPTY, PHONE_EMPTY], truth: 'NO_WEBSITE', expectStatus: 'PROBABLY_NO_WEBSITE' },
  { id: 'google-403', synthetic: true, note: 'site do lead atrás de anti-bot: não avaliável → revisão manual, nunca "sem site"', lead: { ...L, website: 'https://arenatribo.com.br' }, rows: [G, { page: 'https://arenatribo.com.br', status: 403, blocked: true }, NAME_EMPTY, PHONE_EMPTY], truth: 'HAS_WEBSITE', expectStatus: 'UNKNOWN' },
  { id: 'tavily-acha-site', synthetic: true, lead: L, rows: [G, { search: 'NAME', results: [hit('https://arenatribo.com.br/sobre')] }, { page: 'https://arenatribo.com.br', html: OWN }], truth: 'HAS_WEBSITE', expectStatus: 'HAS_WEBSITE' },
  { id: 'homonimo-outra-cidade', synthetic: true, note: 'mesmo nome, outra cidade e telefone', lead: L, rows: [G, { search: 'NAME', results: [hit('https://arenatribo-floripa.com.br')] }, PHONE_EMPTY, { page: 'https://arenatribo-floripa.com.br', html: page('Arena Tribo', '<a href="tel:+554832221111">x</a>', ld('Arena Tribo', 'Florianópolis', '+554832221111')) }], truth: 'NO_WEBSITE', expectStatus: 'UNKNOWN' },
  { id: 'sem-site-limpo', synthetic: true, lead: L, rows: [G, NAME_EMPTY, PHONE_EMPTY], truth: 'NO_WEBSITE', expectStatus: 'PROBABLY_NO_WEBSITE' },
  { id: 'so-diretorios', synthetic: true, lead: L, rows: [G, { search: 'NAME', results: [hit('https://www.tripadvisor.com.br/Arena-Tribo'), hit('https://www.econodata.com.br/arena-tribo')] }, PHONE_EMPTY], truth: 'NO_WEBSITE', expectStatus: 'PROBABLY_NO_WEBSITE' },
  { id: 'so-instagram', synthetic: true, note: '@ confirmado, bio sem site', lead: { ...L, instagramHandle: 'arenatribo' }, rows: [G, NAME_EMPTY, PHONE_EMPTY, { bio: '@arenatribo', website: null }], truth: 'NO_WEBSITE', expectStatus: 'SOCIAL_ONLY' },
  { id: 'bio-com-site', synthetic: true, lead: { ...L, instagramHandle: 'arenatribo' }, rows: [G, { bio: '@arenatribo', website: 'https://arenatribo.com.br' }, { page: 'https://arenatribo.com.br', html: OWN }], truth: 'HAS_WEBSITE', expectStatus: 'HAS_WEBSITE' },
  { id: 'plataforma-compartilhada-certo', synthetic: true, lead: { ...L, website: 'https://plataforma.com.br/site/arenatribo', foundWebsite: 'https://plataforma.com.br/site/outraarena' }, rows: [G, { page: 'https://plataforma.com.br/site/arenatribo', html: OWN }, { page: 'https://plataforma.com.br/site/outraarena', html: OTHER }], truth: 'HAS_WEBSITE', expectStatus: 'HAS_WEBSITE' },
  { id: 'plataforma-compartilhada-so-outro', synthetic: true, lead: { ...L, website: 'https://plataforma.com.br/site/outraarena' }, rows: [G, { page: 'https://plataforma.com.br/site/outraarena', html: OTHER }, NAME_EMPTY, PHONE_EMPTY], truth: 'NO_WEBSITE', expectStatus: 'PROBABLY_NO_WEBSITE' },
  { id: 'redirect-antigo-novo', synthetic: true, lead: { ...L, website: 'https://arenatribo.com.br', foundWebsite: 'https://arenatribo.com' }, rows: [G, { page: 'https://arenatribo.com.br', html: OWN, finalUrl: 'https://novaarena.com.br/' }, { page: 'https://arenatribo.com', html: OWN, finalUrl: 'https://novaarena.com.br/' }], truth: 'HAS_WEBSITE', expectStatus: 'HAS_WEBSITE' },
  { id: 'confirmacao-historica-errada', synthetic: true, lead: { ...L, confirmedWebsite: 'https://antigo-errado.com' }, rows: [G, { page: 'https://antigo-errado.com', html: OTHER }, NAME_EMPTY, PHONE_EMPTY], truth: 'NO_WEBSITE', expectStatus: 'PROBABLY_NO_WEBSITE' },
  { id: 'telefone-so-em-anuncio', synthetic: true, lead: { ...L, website: 'https://noticiasdacidade.com.br' }, rows: [G, { page: 'https://noticiasdacidade.com.br', html: page('Notícias da cidade', '<p>Anúncio: (48) 99123-4567 compre já!</p>') }, NAME_EMPTY, PHONE_EMPTY], truth: 'NO_WEBSITE', expectStatus: 'UNKNOWN' },
  { id: 'investigacao-incompleta', synthetic: true, note: 'só a consulta por nome feita; resto aguardando cota', lead: L, rows: [G, NAME_EMPTY], truth: 'NO_WEBSITE', exhausted: false, expectStatus: 'UNKNOWN' },
]
