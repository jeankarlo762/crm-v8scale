import { Prisma } from '@prisma/client'
import { prisma } from '../config/database'
import { AMBIGUOUS, MUNICIPIO_UF } from '../data/municipios-uf'

// Descobre a UF de um prospect quando a busca não informou ("Tubarão" em vez de "Tubarão - SC").
// Ordem: componentes de endereço do Google → endereço formatado ("..., Tubarão - SC, 88700-000, Brasil") →
// tabela de municípios do IBGE pelo nome da cidade (só quando o nome existe em uma única UF).

const UFS = new Set(['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'])

export function foldCity(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/['’]/g, '').replace(/-/g, ' ').split(/\s+/).filter(Boolean).join(' ')
}

interface AddressComponent { longText?: string | null; shortText?: string | null; types?: string[] }

export interface StateSource {
  state?: string | null
  city?: string | null
  address?: string | null
  addressComponents?: unknown
}

function fromComponents(comps: unknown): string | null {
  if (!Array.isArray(comps)) return null
  const uf = (comps as AddressComponent[]).find((c) => c.types?.includes('administrative_area_level_1'))?.shortText?.toUpperCase()
  return uf && UFS.has(uf) ? uf : null
}

function fromAddress(address: string | null | undefined, city: string | null | undefined): string | null {
  if (!address) return null
  // "Rua X, 10 - Centro, Tubarão - SC, 88701-000, Brasil" → o " - SC" logo depois da cidade (ou qualquer " - UF," do fim).
  const matches = [...address.matchAll(/\s-\s([A-Z]{2})(?=\s*,|\s*$)/g)].map((m) => m[1])
  if (city) {
    const want = foldCity(city)
    const re = new RegExp(`${want.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*-\\s*([a-z]{2})(?=\\s*,|\\s*$)`)
    const m = foldCity(address).match(re)
    if (m && UFS.has(m[1].toUpperCase())) return m[1].toUpperCase()
  }
  const last = matches.length ? matches[matches.length - 1] : null
  return last && UFS.has(last) ? last : null
}

export function fromCityName(city: string | null | undefined): string | null {
  if (!city) return null
  // "Tubarão - SC" / "Tubarão/SC" já traz a UF.
  const m = city.match(/^(.*?)\s*[-/]\s*([A-Za-z]{2})$/)
  if (m && UFS.has(m[2].toUpperCase())) return m[2].toUpperCase()
  const key = foldCity(city)
  if (MUNICIPIO_UF[key]) return MUNICIPIO_UF[key]
  return null // ambíguo (ex.: "Bom Jesus" existe em várias UFs) ou desconhecido
}

/** UF do prospect (2 letras) ou null quando não dá para afirmar com segurança. */
export function inferState(p: StateSource): string | null {
  if (p.state && UFS.has(p.state.toUpperCase())) return p.state.toUpperCase()
  return fromComponents(p.addressComponents) ?? fromAddress(p.address, p.city) ?? fromCityName(p.city)
}

/** Possíveis UFs de uma cidade com nome repetido (para a tela sugerir). */
export function candidateStates(city: string): string[] {
  return AMBIGUOUS[foldCity(city)] ?? []
}

/** Preenche a UF dos prospects que estão sem ela. Idempotente; só grava quando descobre algo. */
export async function backfillProspectStates(): Promise<{ scanned: number; filled: number; unresolved: number }> {
  const rows = await prisma.prospect.findMany({
    where: { state: null, city: { not: null } },
    select: { id: true, city: true, address: true, addressComponents: true },
  })
  let filled = 0
  const byState = new Map<string, string[]>()
  for (const r of rows) {
    const uf = inferState({ city: r.city, address: r.address, addressComponents: r.addressComponents as Prisma.JsonValue })
    if (!uf) continue
    byState.set(uf, [...(byState.get(uf) ?? []), r.id])
  }
  for (const [uf, ids] of byState) {
    const res = await prisma.prospect.updateMany({ where: { id: { in: ids }, state: null }, data: { state: uf } })
    filled += res.count
  }
  return { scanned: rows.length, filled, unresolved: rows.length - filled }
}
