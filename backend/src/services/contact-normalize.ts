// Normalização de telefone e endereço brasileiros para COMPARAÇÃO. Estrita de propósito: casar demais cria falso
// "mesma empresa". Puro, sem I/O.

export const fold = (t: string): string => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

// Forma canônica de um telefone BR: DDD + número, SEM +55, com o 9º dígito de celular sempre presente.
//  - 10 dígitos começando por 6-9 no número = celular antigo (sem o 9) → vira 11 dígitos;
//  - 10 dígitos começando por 2-5 = fixo → fica 10 (NÃO colide com celular de mesmos 8 últimos dígitos);
//  - 11 dígitos precisam começar por 9; DDD válido (11-99); 0800/4004 etc. não são telefone de contato.
export function canonicalBrPhone(raw: string): string | null {
  let d = raw.replace(/\D/g, '')
  if (d.startsWith('55') && (d.length === 12 || d.length === 13)) d = d.slice(2)
  else if (d.startsWith('0') && (d.length === 11 || d.length === 12)) d = d.slice(1)
  if (d.length !== 10 && d.length !== 11) return null
  const ddd = d.slice(0, 2)
  if (Number(ddd) < 11 || ddd[1] === '0') return null
  let num = d.slice(2)
  if (num.length === 8) {
    if (/^[6-9]/.test(num)) num = `9${num}`
    else if (!/^[2-5]/.test(num)) return null
  } else if (num[0] !== '9') return null
  return `${ddd}${num}`
}

// Telefone do lead em forma canônica (E.164 +55... ou o texto de WhatsApp). Telefone estrangeiro não casa com site BR.
export function leadPhoneCanon(lead: { phoneE164?: string | null; whatsapp?: string | null }): string | null {
  if (lead.phoneE164) return lead.phoneE164.startsWith('+55') ? canonicalBrPhone(lead.phoneE164) : null
  return lead.whatsapp ? canonicalBrPhone(lead.whatsapp) : null
}

// Telefones com formatação (parênteses, separador entre blocos ou +55) — não pega ID/CNPJ/CEP soltos no meio de dígitos.
const PHONE_RE = /(?<!\d)(?:\+?55[\s.-]?)?(?:\(\s*\d{2}\s*\)|\d{2})[\s.-]?9?\d{4}[\s.-]\d{4}(?!\d)|(?<!\d)\+55\d{10,11}(?!\d)/g
export function phonesInText(text: string): Set<string> {
  const out = new Set<string>()
  for (const m of text.matchAll(PHONE_RE)) {
    const k = canonicalBrPhone(m[0])
    if (k) out.add(k)
  }
  return out
}

// Valor de href tel:/wa.me/whatsapp (aceita dígitos corridos, pois o contexto já diz que é telefone).
export function phoneFromLinkValue(v: string): string | null {
  return canonicalBrPhone(decodeURIComponent(v).replace(/[^\d+]/g, ''))
}

// ── Endereço ───────────────────────────────────────────────────────────

const STREET_TYPE: Record<string, string> = {
  r: 'rua', rua: 'rua', av: 'avenida', avenida: 'avenida', rod: 'rodovia', rodovia: 'rodovia', tv: 'travessa', trav: 'travessa', travessa: 'travessa',
  al: 'alameda', alameda: 'alameda', pc: 'praca', pca: 'praca', praca: 'praca', est: 'estrada', estr: 'estrada', estrada: 'estrada', lg: 'largo', largo: 'largo',
  serv: 'servidao', servidao: 'servidao', beco: 'beco',
}

export interface ParsedAddress { street: string | null; number: string | null; cep: string | null; city: string | null; neighborhood: string | null }

interface Component { longText?: string; shortText?: string; types?: string[] }

// Rua sem o tipo ("R. das Flores" → "das flores").
export function streetCore(street: string): string {
  const words = fold(street).replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean)
  if (words.length > 1 && STREET_TYPE[words[0]]) words.shift()
  return words.join(' ')
}

export function parseLeadAddress(address: string | null | undefined, components?: Component[] | null): ParsedAddress {
  const out: ParsedAddress = { street: null, number: null, cep: null, city: null, neighborhood: null }
  const pick = (t: string) => components?.find((c) => c.types?.includes(t))?.longText
  const route = pick('route')
  if (route) {
    out.street = streetCore(route)
    out.number = pick('street_number') ?? null
    out.cep = pick('postal_code')?.replace(/\D/g, '') ?? null
    out.city = fold(pick('locality') ?? pick('administrative_area_level_2') ?? '') || null
    out.neighborhood = fold(pick('sublocality_level_1') ?? pick('sublocality') ?? pick('neighborhood') ?? '') || null
  }
  if (address && (!out.street || !out.number)) {
    const m = address.match(/^([^,]+?)\s*,\s*(\d+[A-Za-z]?)\b/)
    if (m) { out.street ??= streetCore(m[1]); out.number ??= m[2] }
    // "R. X, 123 - Centro, Tubarão - SC, 88700-000, Brasil": bairro e cidade
    const full = address.match(/^[^,]+,\s*\d+[A-Za-z]?\s*(?:-\s*([^,]+))?,\s*([^,]+?)\s*-\s*[A-Za-z]{2}\b/)
    if (full) { out.neighborhood ??= full[1] ? fold(full[1]).trim() : null; out.city ??= fold(full[2]).trim() || null }
    out.cep ??= address.match(/\b(\d{5})-?(\d{3})\b/)?.slice(1, 3).join('') ?? null
  }
  if (out.number) out.number = out.number.toLowerCase()
  if (out.street && out.street.length < 4) out.street = null // "sul", "um": curto demais para identificar
  return out
}

// O endereço do lead aparece COMPLETO neste trecho? Exige rua + número (perto) e mais um âncora: CEP, cidade ou bairro.
export function addressInChunk(a: ParsedAddress, chunk: string): boolean {
  if (!a.street || !a.number) return false
  const t = fold(chunk).replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ')
  const street = a.street.replace(/\s+/g, ' ')
  const re = new RegExp(`(?:^| )${street.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?: [a-z]{1,4}){0,2} (?:n |no |numero )?${a.number.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![0-9a-z])`)
  if (!re.test(t)) return false
  const digits = chunk.replace(/\D/g, '')
  if (a.cep && digits.includes(a.cep)) return true
  const has = (w: string | null) => !!w && w.length >= 3 && new RegExp(`(?:^| )${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?: |$)`).test(t)
  return has(a.city) || has(a.neighborhood)
}
