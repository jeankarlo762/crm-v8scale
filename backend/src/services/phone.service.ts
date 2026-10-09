// Normalização de telefones do Places: E.164 via libphonenumber-js, com tipo (celular/fixo) por país.
import { parsePhoneNumberFromString } from 'libphonenumber-js/max'

export interface ParsedPhone {
  e164: string // +5548999087963
  country: string | null // BR, AR...
  isMobile: boolean // celular por regra do país (BR: 9º dígito; AR: +54 9 ...) -> pode ter WhatsApp
  display: string // BR: formato nacional; estrangeiro: internacional
}

// Tenta cada texto em ordem (internacionalPhoneNumber primeiro, depois o nacional). Sem DDI, assume `defaultCountry`.
export function parsePhone(candidates: (string | null | undefined)[], defaultCountry: 'BR' | 'AR' | 'PT' | 'US' = 'BR'): ParsedPhone | null {
  for (const raw of candidates) {
    if (!raw?.trim()) continue
    const n = parsePhoneNumberFromString(raw, defaultCountry)
    if (!n || !n.isValid()) continue
    const type = n.getType()
    return {
      e164: n.number,
      country: n.country ?? null,
      isMobile: type === 'MOBILE' || type === 'FIXED_LINE_OR_MOBILE',
      display: n.country === 'BR' ? n.formatNational() : n.formatInternational(),
    }
  }
  return null
}

// Chave de comparação: E.164 quando válido, senão só dígitos (sem o +55 de números BR).
export function phoneKey(v: string | null | undefined): string | null {
  const parsed = parsePhone([v])
  if (parsed) return parsed.e164
  const d = (v ?? '').replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '')
  return d.length >= 8 ? d : null
}

// Campos de telefone do Prospect a partir do que o Google devolve (internacional/nacional).
export function phoneFields(internacional: string | null, nacional: string | null) {
  const parsed = parsePhone([internacional, nacional])
  return {
    whatsapp: parsed?.display ?? nacional ?? internacional,
    phoneE164: parsed?.e164 ?? null,
    phoneCountry: parsed?.country ?? null,
    phoneMobile: parsed ? parsed.isMobile : null,
  }
}
