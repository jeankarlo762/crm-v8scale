// "Este site é DESTE estabelecimento?" — separado de "que tipo de URL é" e de "o site está no ar".
// Puro: recebe o lead e os FATOS da página (page-facts) e devolve o VÍNCULO (linkage) + as evidências.
//
// Regras (heurísticas, não calibradas):
//  - nome, domínio parecido e cidade são sinais FRACOS e correlacionados: sozinhos não confirmam;
//  - CONFIRMED exige combinação forte: telefone exato em contato empresarial + nome, endereço completo + nome,
//    link exato para o Instagram confirmado + nome — ou 2 sinais fortes independentes;
//  - ausência de evidência ≠ contradição: telefone não achado, página sem nome, 403/anti-bot/HTML vazio = inconclusivo/não avaliável;
//  - contradição só com contato/dado estruturado de OUTRA empresa; outra unidade da mesma marca = relação a investigar;
//  - score de relevância de busca (Tavily) NUNCA entra aqui.
import { domainRelatesToBusiness, normalizeNameTokens } from './domain-classifier.service'
import { addressInChunk, fold, leadPhoneCanon, parseLeadAddress } from './contact-normalize'
import type { PageFacts } from './page-facts.service'
import type { Evidence } from './website-types'

export type { Evidence }
export { phonesInText } from './contact-normalize'

export type Linkage = 'CONFIRMED' | 'PLAUSIBLE' | 'INCONCLUSIVE' | 'NOT_EVALUABLE' | 'CONTRADICTED' | 'BRAND_OTHER_UNIT'

export const IDENTITY_WEIGHTS = {
  phoneBusiness: 0.5, // telefone exato em tel:/WhatsApp/dado estruturado/seção de contato
  address: 0.4, // rua + número + (CEP | cidade | bairro) em dado estruturado/contato
  instagramLink: 0.3, // link exato (href) para o @ CONFIRMADO do lead
  nameIdentity: 0.2, // todos os termos distintivos no título/og:site_name/h1/JSON-LD
  nameText: 0.1, // todos os termos distintivos no texto
  cityInPage: 0.05,
  domainName: 0.05,
  otherCompany: -0.5,
  otherCity: -0.3,
}

export interface IdentityLead {
  arenaName: string
  city: string | null
  state: string | null
  address?: string | null
  addressComponents?: { longText?: string; shortText?: string; types?: string[] }[] | null
  phoneE164?: string | null
  whatsapp?: string | null
  instagramHandle?: string | null
  instagramConfirmed?: boolean // @ confirmado (não "verificar")
  phoneShared?: boolean // outro lead usa o mesmo telefone: contato compartilhado, não prova dono
  instagramShared?: boolean // outro lead usa o mesmo @: perfil da marca/compartilhado, não prova uma unidade
}

export interface IdentityResult { linkage: Linkage; confidence: number; evidence: Evidence[]; strong: string[] }

const esc = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const hasWord = (text: string, w: string) => new RegExp(`(?:^|[^a-z0-9])${esc(w)}(?:[^a-z0-9]|$)`).test(text)

const STOP = new Set(['de', 'do', 'da', 'dos', 'das', 'e', 'em', 'the', 'and', 'a', 'o'])
// Termos distintivos do nome; se o nome só tem palavras genéricas ("Arena Hotel"), usa todas as palavras.
export function distinctiveTokens(name: string): string[] {
  const t = normalizeNameTokens(name).filter((x) => x.length >= 3)
  if (t.length) return t
  return fold(name).replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((x) => x.length >= 3 && !STOP.has(x))
}

export function matchIdentity(lead: IdentityLead, facts: PageFacts, source = 'WEBSITE'): IdentityResult {
  const W = IDENTITY_WEIGHTS
  const ev: Evidence[] = []
  const at = facts.fetchedAt
  const add = (type: string, value: string | null, confidence: number) => ev.push({ source, type, value, confidence, at })

  if (!facts.evaluable) {
    add('PAGE_NOT_EVALUABLE', facts.notEvaluableReason, 0)
    return { linkage: 'NOT_EVALUABLE', confidence: 0, evidence: ev, strong: [] }
  }

  const tokens = distinctiveTokens(lead.arenaName)
  const identityText = facts.identityNames.join(' | ')
  const structuredText = facts.structuredNames.join(' | ')
  const nameInIdentity = tokens.length > 0 && tokens.every((t) => hasWord(identityText, t))
  const nameInText = tokens.length > 0 && tokens.every((t) => hasWord(facts.textSample, t))
  const nameAny = nameInIdentity || nameInText
  if (nameInIdentity) add('NAME_IN_IDENTITY', lead.arenaName, W.nameIdentity)
  else if (nameInText) add('NAME_IN_TEXT', lead.arenaName, W.nameText)

  const parsed = parseLeadAddress(lead.address, lead.addressComponents)
  const phone = leadPhoneCanon(lead)
  const city = fold(lead.city ?? '').trim()

  // Sinais associados ao MESMO estabelecimento: entidades estruturadas (JSON-LD) cujo nome é o do lead. Em página que lista
  // várias empresas/unidades, só estes sinais valem — nome de um bloco + telefone/endereço de outro não confirmam nada.
  const multi = facts.multiBusiness
  const leadEntities = (facts.entities ?? []).filter((e) => tokens.length > 0 && tokens.every((t) => hasWord(e.name, t)))
  const entityPhone = !!phone && leadEntities.some((e) => e.phones.includes(phone))
  const entityAddress = leadEntities.some((e) => e.addresses.some((a) => addressInChunk(parsed, a)))

  // Telefone: só origens "de negócio" contam; página que lista várias empresas ou telefone compartilhado enfraquece.
  const business = new Set([...facts.phones.tel, ...facts.phones.whatsapp, ...facts.phones.structured, ...facts.phones.contact])
  const phoneOnBusiness = !!phone && business.has(phone)
  const phoneOnlyGeneric = !!phone && !phoneOnBusiness && facts.phones.generic.includes(phone)
  const phoneWeakContext = multi || !!lead.phoneShared
  const phoneStrong = multi ? entityPhone : phoneOnBusiness
  if (phoneOnBusiness) add(multi ? (entityPhone ? 'PHONE_MATCH_SAME_ENTITY' : 'PHONE_MATCH_MULTI_BUSINESS_PAGE') : 'PHONE_MATCH_BUSINESS', phone, multi ? (entityPhone ? W.phoneBusiness : 0.05) : W.phoneBusiness)
  else if (phoneOnlyGeneric) add('PHONE_ONLY_IN_GENERIC_CONTENT_IGNORED', phone, 0)
  else if (phone && business.size > 0) add('PHONE_DIFFERENT', [...business].slice(0, 2).join(','), 0) // inconclusivo: pode ser outro número da empresa

  // Endereço completo (estruturado ou seção de contato); em página multiempresa, só no mesmo bloco do nome.
  const addrChunks = [...facts.addresses, facts.contactText]
  const addressStrong = multi ? entityAddress : addrChunks.some((c) => addressInChunk(parsed, c))
  if (addressStrong) add('ADDRESS_MATCH', `${parsed.street} ${parsed.number}`, W.address)

  // Instagram: só link exato para o @ CONFIRMADO; link solto numa página multiempresa não é do estabelecimento.
  const handle = lead.instagramHandle?.toLowerCase()
  const igStrong = !multi && !!handle && !!lead.instagramConfirmed && facts.instagram.includes(handle)
  if (igStrong) add('INSTAGRAM_LINK_MATCH', `@${handle}`, W.instagramLink)

  // Sinais fracos
  const cityInPage = city.length >= 3 && (hasWord(facts.contactText, city) || facts.structuredCity.includes(city) || hasWord(facts.textSample, city))
  if (cityInPage) add('CITY_IN_PAGE', lead.city, W.cityInPage)
  let host = ''
  try { host = new URL(facts.finalUrl).hostname } catch { /* sem host */ }
  const domainSimilar = !!host && domainRelatesToBusiness(host, lead.arenaName, lead.instagramHandle)
  if (domainSimilar) add('DOMAIN_NAME_SIMILAR', host, W.domainName)

  // Unidade: contradições de estabelecimento são avaliadas ANTES de confirmar. Telefone central, perfil da marca e nome
  // compartilhado não comprovam uma filial específica. A evidência de unidade vem dos dados estruturados E do texto visível
  // (blocos de contato/endereço/rodapé), da página principal e das internas já lidas (fatos mesclados).
  const textCities = new Set(facts.unitCities ?? [])
  const unitCities = new Set([...facts.structuredCity, ...(facts.entities ?? []).flatMap((e) => e.cities), ...textCities])
  const cityListed = !!city && unitCities.has(city)
  const cityInContact = city.length >= 3 && hasWord(facts.contactText, city)
  const structuredCityOther = !!city && unitCities.size > 0 && !cityListed
  const multiUnit = unitCities.size >= 2 // o site atende/lista várias unidades
  const unitProof = addressStrong || cityListed || cityInContact
  const unitConflict = structuredCityOther && !addressStrong && !cityInContact // só OUTRA(s) unidade(s) aparece(m)
  // contato compartilhado (telefone/@ usados por outros leads) ou site multiunidade: telefone/@ + nome NÃO bastam sem a unidade
  const sharedSignals = !!lead.phoneShared || !!lead.instagramShared || multiUnit
  const proofOk = !sharedSignals || unitProof

  const strong = [phoneStrong && 'PHONE', addressStrong && 'ADDRESS', igStrong && 'INSTAGRAM'].filter((x): x is string => !!x)
  // Telefone compartilhado (outro lead usa o mesmo) ou página de várias empresas: o nome precisa estar na IDENTIDADE da página
  // (título/og/h1/JSON-LD) — ou, em página multiempresa, na MESMA entidade do telefone/endereço.
  const nameOkForPhone = multi ? entityPhone : phoneWeakContext ? nameInIdentity : nameAny
  const nameOkForOthers = multi ? leadEntities.length > 0 : nameAny
  const independentStrong = [phoneStrong && !phoneWeakContext && 'PHONE', addressStrong && 'ADDRESS', igStrong && 'INSTAGRAM'].filter(Boolean).length
  const confirmed = !unitConflict && ((addressStrong && nameOkForOthers) || (proofOk && ((phoneStrong && nameOkForPhone) || (igStrong && nameOkForOthers) || independentStrong >= 2)))
  const conf = (n: number) => Math.round(Math.min(1, Math.max(0, n)) * 100) / 100
  if (confirmed) {
    return { linkage: 'CONFIRMED', confidence: conf(0.7 + 0.1 * Math.min(2, strong.length - 1) + (nameInIdentity ? 0.05 : 0)), evidence: ev, strong }
  }

  // Sinais que apontam para o negócio/marca, mas só provam OUTRA unidade (ou nenhuma em particular)
  if (unitConflict && (nameAny || phoneOnBusiness || igStrong)) {
    add(multiUnit ? 'BRAND_LISTS_OTHER_UNITS_ONLY' : 'SAME_BRAND_OTHER_CITY', [...unitCities].slice(0, 3).join(','), 0)
    return { linkage: 'BRAND_OTHER_UNIT', confidence: 0, evidence: ev, strong }
  }
  if (multi && !leadEntities.length) add('MULTI_BUSINESS_PAGE_SIGNALS_NOT_ASSOCIATED', null, 0)

  if (!proofOk && (phoneStrong || igStrong) && nameAny) { // sinais de contato batem, mas nada diz QUAL unidade: pendente, nunca confirmado
    add('SHARED_CONTACT_WITHOUT_UNIT_PROOF', phone ?? `@${handle}`, 0)
    return { linkage: 'PLAUSIBLE', confidence: 0.4, evidence: ev, strong }
  }
  const otherName = facts.structuredNames.length > 0 && tokens.length > 0 && !tokens.some((t) => hasWord(structuredText, t))
  if (otherName && !phoneOnBusiness) {
    add('OTHER_COMPANY_STRUCTURED_DATA', facts.structuredNames[0], W.otherCompany)
    return { linkage: 'CONTRADICTED', confidence: 0, evidence: ev, strong }
  }
  // Outro município isolado só contradiz quando o site NÃO atende várias unidades; um site multiunidade sem a unidade do lead é inconclusivo.
  if (!nameAny && structuredCityOther && !multiUnit && !multi) {
    add('OTHER_CITY_STRUCTURED_ADDRESS', [...unitCities].slice(0, 2).join(','), W.otherCity)
    return { linkage: 'CONTRADICTED', confidence: 0, evidence: ev, strong }
  }
  if (otherName && phoneOnBusiness) { add('PHONE_MATCH_OTHER_NAME', phone, 0); return { linkage: 'INCONCLUSIVE', confidence: 0.2, evidence: ev, strong } }

  if (multi) return { linkage: 'INCONCLUSIVE', confidence: 0.2, evidence: ev, strong: [] }
  if (strong.length >= 1 || (nameInIdentity && (cityInPage || domainSimilar))) return { linkage: 'PLAUSIBLE', confidence: 0.4, evidence: ev, strong }
  return { linkage: 'INCONCLUSIVE', confidence: 0.2, evidence: ev, strong }
}

// HTML → texto visível (compat com código antigo que só quer o texto).
export function htmlToText(html: string, max = 200_000): string {
  return html.slice(0, max)
    .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi, ' $1 ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
}
