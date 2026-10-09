// Evidências por lead, com timestamp próprio por fonte e tipo. A decisão é recalculada SÓ a partir delas (sem APIs).
// Validade de uma evidência:
//  - INVALID: dependia de entradas que mudaram (nome, telefone, endereço, @...) ou foi gerada por outra versão do
//    extrator — nunca entra na decisão e é apagada na limpeza;
//  - EXPIRED: passou do TTL da sua fonte/tipo (positivo e negativo têm validades diferentes) — ainda explica o passado,
//    mas não sustenta uma conclusão NEGATIVA e a etapa correspondente volta a ser executada;
//  - FRESH: vale.
// Evidência vinda de cache (fromCache) guarda o instante REAL da coleta; reutilizá-la nunca a torna "recém-coletada".
import { createHash } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '../config/database'
import { env } from '../config/env'
import { FACTS_VERSION } from './page-facts.service'
import { GOOGLE_COLLECTION_VERSIONS } from './website-types'
import { fold, leadPhoneCanon } from './contact-normalize'

export type EvidenceSource = 'TAVILY' | 'META' | 'WEBSITE' | 'GOOGLE'
export type EvidenceType = 'SEARCH_RESULTS' | 'IG_BIO' | 'PAGE_FACTS' | 'LINK_PAGE' | 'PLACE_FIELDS'

export interface EvidenceRow {
  source: EvidenceSource
  type: EvidenceType
  key: string
  value: unknown
  outcome: string | null
  fromCache: boolean
  collectedAt: Date
  dependsOn: string
  version: string
}

export const rowId = (r: Pick<EvidenceRow, 'source' | 'type' | 'key'>) => `${r.source}|${r.type}|${r.key}`

// Entradas do lead de que as buscas/consultas dependem. Mudou qualquer uma → evidências por consulta ficam inválidas.
export function dependsOnHash(lead: { arenaName: string; city?: string | null; state?: string | null; address?: string | null; phoneE164?: string | null; whatsapp?: string | null }): string {
  const basis = [fold(lead.arenaName).replace(/\s+/g, ' ').trim(), fold(lead.city ?? ''), fold(lead.state ?? ''), fold(lead.address ?? ''), leadPhoneCanon(lead) ?? ''].join('|')
  return createHash('sha1').update(basis).digest('hex').slice(0, 16)
}

export type RowState = 'FRESH' | 'EXPIRED' | 'INVALID'

const H = 3600_000
const TRANSIENT_FACTS_TTL_MS = 6 * H // página não avaliada por erro/indisponível: tenta de novo logo, sem esperar a semana toda
export function ttlMs(row: Pick<EvidenceRow, 'source' | 'type' | 'outcome'> & { value?: unknown }): number {
  if (row.type === 'PAGE_FACTS' && (row.value as { evaluable?: boolean } | null)?.evaluable === false) return Math.min(TRANSIENT_FACTS_TTL_MS, env.SITE_FACTS_TTL_HOURS * H)
  if (row.source === 'TAVILY') return (row.outcome === 'EMPTY' ? env.SEARCH_CACHE_NEGATIVE_TTL_HOURS : env.SEARCH_CACHE_TTL_HOURS) * H
  if (row.source === 'META') return (row.outcome === 'NOT_FOUND' ? env.META_CACHE_NEGATIVE_TTL_HOURS : env.META_CACHE_TTL_HOURS) * H
  if (row.source === 'GOOGLE') return env.GOOGLE_EVIDENCE_TTL_HOURS * H
  return env.SITE_FACTS_TTL_HOURS * H
}

export function rowState(row: EvidenceRow, currentDependsOn: string, now = new Date()): RowState {
  if (row.type === 'PAGE_FACTS' || row.type === 'LINK_PAGE') {
    if (row.version !== FACTS_VERSION) return 'INVALID'
  } else if (row.type === 'PLACE_FIELDS') {
    if (!GOOGLE_COLLECTION_VERSIONS.includes(row.version)) return 'INVALID' // coleta sem o campo websiteUri pedido/versão desconhecida
  } else if (row.dependsOn !== currentDependsOn) return 'INVALID'
  return now.getTime() - row.collectedAt.getTime() > ttlMs(row) ? 'EXPIRED' : 'FRESH'
}

// Evidência da coleta do Google para o campo websiteUri. `websiteUri: null` com a máscara que PEDIU o campo = "consultado, sem
// resultado"; a AUSÊNCIA desta linha = campo desconhecido/não consultado (placeId sozinho não prova nada).
export interface GoogleFieldValue { placeId: string; websiteField: 'QUERIED'; websiteUri: string | null; collection: string }
export function googleEvidenceRow(e: { placeId: string; websiteUri: string | null; collection: string; collectedAt: Date; fromCache: boolean }): EvidenceRow {
  const value: GoogleFieldValue = { placeId: e.placeId, websiteField: 'QUERIED', websiteUri: e.websiteUri, collection: e.collection }
  return { source: 'GOOGLE', type: 'PLACE_FIELDS', key: e.placeId, value, outcome: e.websiteUri ? 'OK' : 'NO_WEBSITE_FIELD', fromCache: e.fromCache, collectedAt: e.collectedAt, dependsOn: '', version: e.collection }
}

export async function loadEvidence(prospectId: string): Promise<EvidenceRow[]> {
  const rows = await prisma.leadEvidence.findMany({ where: { prospectId } })
  return rows.map((r) => ({ source: r.source as EvidenceSource, type: r.type as EvidenceType, key: r.key, value: r.value, outcome: r.outcome, fromCache: r.fromCache, collectedAt: r.collectedAt, dependsOn: r.dependsOn, version: r.version }))
}

export async function saveEvidence(prospectId: string, r: EvidenceRow): Promise<void> {
  const data = { value: r.value as Prisma.InputJsonValue, outcome: r.outcome, fromCache: r.fromCache, collectedAt: r.collectedAt, dependsOn: r.dependsOn, version: r.version }
  await prisma.leadEvidence.upsert({
    where: { prospectId_source_type_key: { prospectId, source: r.source, type: r.type, key: r.key } },
    create: { prospectId, source: r.source, type: r.type, key: r.key, ...data },
    update: data,
  })
}

// Evidência do Google vinda da DESCOBERTA: nunca regride (resposta de cache mais antiga não substitui coleta mais nova)
// e preserva o instante real da resposta.
export async function saveGoogleEvidenceIfNewer(prospectId: string, r: EvidenceRow): Promise<boolean> {
  const cur = await prisma.leadEvidence.findUnique({ where: { prospectId_source_type_key: { prospectId, source: r.source, type: r.type, key: r.key } }, select: { collectedAt: true } })
  if (cur && cur.collectedAt.getTime() >= r.collectedAt.getTime()) return false
  await saveEvidence(prospectId, r)
  return true
}

// Apaga evidências INVALID (entradas mudaram / versão antiga). Preserva o histórico de confirmação, que vive no Prospect.
export async function purgeInvalidEvidence(prospectId: string, rows: EvidenceRow[], currentDependsOn: string): Promise<number> {
  const bad = rows.filter((r) => rowState(r, currentDependsOn) === 'INVALID')
  for (const r of bad) await prisma.leadEvidence.deleteMany({ where: { prospectId, source: r.source, type: r.type, key: r.key } })
  return bad.length
}
