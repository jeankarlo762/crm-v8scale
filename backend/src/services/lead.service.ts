import ExcelJS from 'exceljs'
import { prisma } from '../config/database'
import { parseCidades, searchPlaces, newSearchStats, PlaceResult } from './places.service'
import { getUsage, QuotaRun } from './api-quota.service'
import { selectLeadsForDetails, enqueueDetails } from './details-selection.service'
import { enqueueManySiteClassify, enqueueSiteClassify, getQueueSummary, leadPriority, wakeWaitingFor } from './site-classify-queue.service'
import { listProviderStates, resumeProvider } from './provider-state.service'
import { env } from '../config/env'
import { ownerGroupSize, withOwnerGroups } from './owner-group.service'
import { phoneFields } from './phone.service'
import { isSearchConfigured } from './search-enrich.service'
import { checkSiteHealth, parseSiteUrl } from './site-health.service'
import { extractInstagramHandle } from './site-kind.service'
import { computeLeadScore, eligibleForNoWebsiteCampaign } from './lead-score.service'
import type { ImportLeadsInput } from '../schemas/lead.schema'
import { inferState, type StateSource } from './geo-uf.service'

// Campos de telefone de um lead do Places: E.164 é a fonte principal (internacional primeiro).
export { phoneFields } // movido para phone.service (a fila também usa)

// Campos que vêm do Google e podem ser atualizados num lead existente. Telefone, endereço,
// nota e nº de avaliações só entram se o Google devolveu valor (não apaga o que já temos).
// `website` nunca regride: o Text Search é inconsistente entre chamadas e a ausência de websiteUri
// numa busca não prova que o site saiu do ar (isso é papel do site-health check).
export function googleFieldsUpdate(p: PlaceResult, currentWebsite?: string | null) {
  const newWebsite = p.website?.trim() || null
  const hasPhone = !!(p.telefoneInternacional || p.telefone)
  return {
    ...(newWebsite && newWebsite !== (currentWebsite ?? null) ? { website: newWebsite } : {}),
    ...(hasPhone ? phoneFields(p.telefoneInternacional, p.telefone) : {}),
    ...(p.addressComponents ? { addressComponents: p.addressComponents as object } : {}),
    ...(p.endereco ? { address: p.endereco } : {}),
    ...(p.googleMapsUri ? { googleMapsUrl: p.googleMapsUri } : {}),
    ...(p.avaliacao != null ? { avaliacao: p.avaliacao } : {}),
    ...(p.numAvaliacoes != null ? { numAvaliacoes: p.numAvaliacoes } : {}),
  }
}

function httpError(statusCode: number, message: string) {
  return Object.assign(new Error(message), { statusCode })
}

const MAX_CIDADES = 10
const DIAS_BUSCA_REPETIDA = 7


// ── Nichos ─────────────────────────────────────────────────────────────

export async function listNichos() {
  return prisma.nicho.findMany({ orderBy: { createdAt: 'asc' } })
}

export async function createNicho(nome: string, termosBusca: string[] = []) {
  const exists = await prisma.nicho.findUnique({ where: { nome } })
  if (exists) throw httpError(409, 'Já existe uma aba com esse nome')
  return prisma.nicho.create({ data: { nome, termosBusca: [...new Set(termosBusca)] } })
}

// Aliases de busca do nicho: cada um vira uma query extra no Google (limitada por MAX_GOOGLE_QUERIES_PER_CITY).
export async function updateNichoTermos(id: string, termosBusca: string[]) {
  const nicho = await prisma.nicho.findUnique({ where: { id }, select: { id: true } })
  if (!nicho) throw httpError(404, 'Aba não encontrada')
  return prisma.nicho.update({ where: { id }, data: { termosBusca: [...new Set(termosBusca)] } })
}

export async function deleteNicho(id: string) {
  const nicho = await prisma.nicho.findUnique({ where: { id }, select: { id: true } })
  if (!nicho) throw httpError(404, 'Aba não encontrada')
  await prisma.nicho.delete({ where: { id } }) // leads saem junto (onDelete: Cascade)
}

// ── Leads ──────────────────────────────────────────────────────────────

interface LeadFilters {
  nichoId: string
  statusSite?: string[]
  status?: string
  cidade?: string
  estado?: string // UF (ex.: 'SC')
  responsavel?: string // 'Max' | 'Jean' | 'nenhum' (sem responsável)
  avaliacaoMin?: number
  numAvaliacoesMin?: number
  numAvaliacoesMax?: number
  somenteCelular?: boolean
  decisao?: string[] // websiteStatus (HAS_WEBSITE, PROBABLY_NO_WEBSITE, SOCIAL_ONLY, UNKNOWN, CONFLICT, SEM_DECISAO)
  andamento?: string[] // investigationState (PENDING, PROCESSING, WAITING_QUOTA, WAITING_RETRY, DONE, MANUAL_REVIEW, LEGADO)
  somenteLiberados?: boolean // decisão de ausência de site com confiança mínima (público de campanha "sem site")
}

// Cidades distintas que têm lead (de um nicho ou de todos) — alimenta os filtros por cidade.
export async function listCidades(nichoId?: string, estado?: string) {
  const rows = await prisma.prospect.findMany({
    where: { city: { not: null }, ...(nichoId ? { nichoId } : {}), ...(estado ? { state: estado } : {}) },
    select: { city: true },
    distinct: ['city'],
    orderBy: { city: 'asc' },
  })
  return rows.map((r) => r.city as string)
}

// Estados (UF) distintos que têm lead (de um nicho ou de todos) — alimenta os filtros por estado.
export async function listEstados(nichoId?: string) {
  const rows = await prisma.prospect.findMany({
    where: { state: { not: null }, ...(nichoId ? { nichoId } : {}) },
    select: { state: true },
    distinct: ['state'],
    orderBy: { state: 'asc' },
  })
  return rows.map((r) => r.state as string)
}

// Ordem padrão da tabela de Prospecção e da Campanha: maior leadScore primeiro.
export function compareLeads(
  a: { leadScore: number; avaliacao: number | null; numAvaliacoes: number | null },
  b: { leadScore: number; avaliacao: number | null; numAvaliacoes: number | null },
): number {
  return b.leadScore - a.leadScore || (b.avaliacao ?? 0) - (a.avaliacao ?? 0) || (b.numAvaliacoes ?? 0) - (a.numAvaliacoes ?? 0)
}

export async function listLeads(filters: LeadFilters) {
  const leads = await prisma.prospect.findMany({
    where: {
      nichoId: filters.nichoId,
      ...(filters.statusSite ? { statusSite: { in: filters.statusSite } } : {}),
      status: filters.status,
      city: filters.cidade,
      state: filters.estado,
      ...(filters.somenteCelular ? { phoneMobile: true } : {}),
      ...(filters.decisao ? { OR: filters.decisao.map((d) => (d === 'SEM_DECISAO' ? { websiteStatus: null } : { websiteStatus: d })) } : {}),
      ...(filters.andamento ? { AND: [{ OR: filters.andamento.map((a) => (a === 'LEGADO' ? { investigationState: null } : { investigationState: a })) }] } : {}),
      ...(filters.responsavel ? { responsavel: filters.responsavel === 'nenhum' ? null : filters.responsavel } : {}),
      ...(filters.avaliacaoMin != null ? { avaliacao: { gte: filters.avaliacaoMin } } : {}),
      ...(filters.numAvaliacoesMin != null || filters.numAvaliacoesMax != null
        ? { numAvaliacoes: { gte: filters.numAvaliacoesMin, lte: filters.numAvaliacoesMax } }
        : {}),
    },
  })
  const out = filters.somenteLiberados ? leads.filter((l) => eligibleForNoWebsiteCampaign(l)) : leads
  const rows = await withOwnerGroups(out.sort(compareLeads))
  const names = await responsavelNames(rows.map((l) => l.responsavel))
  return rows.map((l) => ({ ...l, responsavelNome: l.responsavel ? names.get(l.responsavel) ?? null : null }))
}

// Exclui leads em lote. Destinatários de campanhas já criadas não são afetados
// (CampaignRecipient guarda nome/telefone próprios; o vínculo só vira null).
export async function deleteLeads(ids: string[]) {
  const { count } = await prisma.prospect.deleteMany({ where: { id: { in: ids } } })
  return { deleted: count }
}

/** Nome dos usuários responsáveis, para listagem e exportação (responsavel guarda o id do User). */
async function responsavelNames(ids: (string | null)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((v): v is string => !!v))]
  if (unique.length === 0) return new Map()
  const users = await prisma.user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } })
  return new Map(users.map((u) => [u.id, u.name]))
}

/**
 * Converte um prospect em lead do funil comercial. Idempotente: se já foi convertido,
 * devolve o lead existente. O prospect continua na Prospecção (status avança para
 * 'negociando' se ainda estava antes disso) e guarda o vínculo em convertedLeadId.
 */
export async function convertToLead(prospectId: string, requestUserId: string) {
  const p = await prisma.prospect.findUnique({ where: { id: prospectId }, include: { nicho: { select: { nome: true } } } })
  if (!p) throw httpError(404, 'Lead não encontrado')
  if (p.convertedLeadId) {
    const existing = await prisma.lead.findUnique({ where: { id: p.convertedLeadId }, select: { id: true, name: true } })
    if (existing) return { created: false, leadId: existing.id, name: existing.name }
  }
  const stage = await prisma.stage.findFirst({ where: { kind: 'OPEN' }, orderBy: { position: 'asc' } })
  if (!stage) throw httpError(400, 'O funil não tem nenhuma etapa em aberto')
  const ownerId = p.responsavel ?? requestUserId
  const owner = await prisma.user.findUnique({ where: { id: ownerId }, select: { id: true, active: true } })
  const finalOwner = owner?.active ? owner.id : requestUserId

  const BEFORE_NEGOCIANDO = new Set(['nao_contatado', 'contato_1', 'contato_2', 'contato_3', 'sem_retorno'])
  const lead = await prisma.$transaction(async (tx) => {
    const created = await tx.lead.create({
      data: {
        name: p.arenaName,
        contactName: p.contactName,
        phone: p.phoneE164 ?? p.whatsapp,
        city: p.city,
        state: p.state,
        source: 'Prospecção',
        segment: p.nicho?.nome ?? null,
        notes: [p.notes, p.instagramHandle ? `Instagram: @${p.instagramHandle}` : p.instagram ? `Instagram: ${p.instagram}` : null, p.foundWebsite ?? p.website ? `Site: ${p.foundWebsite ?? p.website}` : null, p.googleMapsUrl ? `Google Maps: ${p.googleMapsUrl}` : null]
          .filter(Boolean)
          .join('\n') || null,
        stageId: stage.id,
        ownerId: finalOwner,
        activities: { create: { type: 'NOTE', userId: requestUserId, content: `Lead criado a partir da Prospecção (aba ${p.nicho?.nome ?? 'sem nicho'})` } },
      },
      select: { id: true, name: true },
    })
    await tx.prospect.update({
      where: { id: p.id },
      data: { convertedLeadId: created.id, ...(BEFORE_NEGOCIANDO.has(p.status) ? { status: 'negociando' } : {}) },
    })
    return created
  })
  return { created: true, leadId: lead.id, name: lead.name }
}

// Status que significam "entrou em negociação": o prospect precisa existir no funil de vendas.
const FUNNEL_STATUSES = new Set(['negociando', 'fechado'])

/** Garante o lead do funil para prospects que chegaram a 'negociando'/'fechado' (idempotente, best-effort). */
async function ensureFunnelLead(ids: string[], status: string, requestUserId: string) {
  if (!FUNNEL_STATUSES.has(status)) return
  const pending = await prisma.prospect.findMany({ where: { id: { in: ids }, convertedLeadId: null }, select: { id: true } })
  for (const p of pending) {
    try {
      await convertToLead(p.id, requestUserId)
    } catch (err) {
      console.error(`[prospeccao] não foi possível criar o lead do funil para o prospect ${p.id}:`, err)
    }
  }
}

export async function updateLead(id: string, data: { status?: string; notes?: string | null; responsavel?: string | null; foundWebsite?: string | null; instagramHandle?: string | null }, requestUserId?: string) {
  const lead = await prisma.prospect.findUnique({ where: { id } })
  if (!lead) throw httpError(404, 'Lead não encontrado')
  const { foundWebsite, instagramHandle, ...rest } = data
  const notes = rest.notes === undefined ? undefined : rest.notes?.trim() || null
  const manual: Record<string, unknown> = {}

  // Site/@ à mão: marca como manual (buscas futuras não sobrescrevem) e reclassifica.
  if (foundWebsite !== undefined) {
    const url = foundWebsite?.trim() ? parseSiteUrl(foundWebsite) : null
    if (foundWebsite?.trim() && !url) throw httpError(400, 'Site inválido')
    const health = url ? await checkSiteHealth(url.origin) : null
    Object.assign(manual, {
      foundWebsite: url ? url.origin : null,
      foundWebsiteVerificar: false,
      foundWebsiteSource: url ? 'manual' : null,
      foundSiteStatus: health?.status ?? null,
      foundSiteCheckReason: health?.reason ?? null,
      siteManual: !!url,
    })
  }
  if (instagramHandle !== undefined) {
    const raw = instagramHandle?.trim().replace(/^@/, '').toLowerCase() ?? ''
    const handle = !raw ? null : /^[\w.]{1,30}$/.test(raw) ? raw : extractInstagramHandle(raw)
    if (raw && !handle) throw httpError(400, '@ do Instagram inválido')
    Object.assign(manual, { instagramHandle: handle, instagramVerificar: false, instagramManual: !!handle })
  }

  const updated = await prisma.prospect.update({ where: { id }, data: { ...rest, notes, ...manual } })
  if (rest.status && requestUserId) await ensureFunnelLead([id], rest.status, requestUserId)
  if (Object.keys(manual).length === 0) return updated
  const scored = await prisma.prospect.update({ where: { id }, data: { leadScore: computeLeadScore({ ...updated, ownerGroupSize: await ownerGroupSize(updated) }) } })
  await enqueueSiteClassify(id) // decisão recalculada com a informação manual (sem gastar API que a evidência já cobre)
  return scored
}

export async function bulkUpdateStatus(ids: string[], status: string, requestUserId?: string) {
  const r = await prisma.$transaction(async (tx) => tx.prospect.updateMany({ where: { id: { in: ids } }, data: { status } }))
  if (requestUserId) await ensureFunnelLead(ids, status, requestUserId)
  return { updated: r.count }
}

export async function bulkUpdateResponsavel(ids: string[], responsavel: string | null) {
  const r = await prisma.$transaction(async (tx) => tx.prospect.updateMany({ where: { id: { in: ids } }, data: { responsavel } }))
  return { updated: r.count }
}

// ── Cota e log de buscas ───────────────────────────────────────────────

export async function getQuota() {
  const now = new Date()
  const inicioMes = new Date(now.getFullYear(), now.getMonth(), 1)
  const agg = await prisma.buscaLog.aggregate({ _sum: { numChamadas: true }, where: { criadoEm: { gte: inicioMes }, mock: false } })
  return { usadas: agg._sum.numChamadas ?? 0, limite: env.GOOGLE_TEXT_SEARCH_PRO_MONTHLY_BUDGET ?? null }
}

// Consumo das APIs externas (mês/hora) contra o orçamento interno + chamadas poupadas por cache/short-circuit/cota.
export async function getConsumo() {
  return { ...(await getUsage()), integracoes: await listProviderStates() }
}

// Contadores da aba: decisão (o que sabemos) e andamento (em que ponto está) — separados de propósito.
export async function getResumoInvestigacao(nichoId?: string) {
  return getQueueSummary(nichoId)
}

// Credencial corrigida: retoma a integração pausada e acorda os leads que esperavam por ela.
export async function retomarIntegracao(provider: string) {
  if (!['GOOGLE_PLACES', 'TAVILY', 'META'].includes(provider)) throw httpError(400, 'Provedor inválido')
  await resumeProvider(provider)
  return { retomado: provider, acordados: await wakeWaitingFor(provider) }
}

// Cidades (da lista digitada) já buscadas nesse nicho nos últimos 7 dias.
export async function buscasRecentes(nichoId: string, cidadesInput: string) {
  const cidades = parseCidades(cidadesInput)
  const desde = new Date(Date.now() - DIAS_BUSCA_REPETIDA * 24 * 60 * 60 * 1000)
  const logs = await prisma.buscaLog.findMany({
    where: { nichoId, cidade: { in: cidades }, criadoEm: { gte: desde } },
    orderBy: { criadoEm: 'desc' },
  })
  const ultima = new Map<string, Date>()
  for (const l of logs) if (!ultima.has(l.cidade)) ultima.set(l.cidade, l.criadoEm)
  return [...ultima].map(([cidade, quando]) => ({
    cidade,
    diasAtras: Math.floor((Date.now() - quando.getTime()) / (24 * 60 * 60 * 1000)),
  }))
}

const SITE_LABEL: Record<string, string> = {
  sem_site: 'Sem site no Google',
  so_instagram: 'Só Instagram',
  so_facebook: 'Só Facebook',
  link_bio: 'Só link na bio',
  so_ota: 'Só Booking/Airbnb',
  site_proprio: 'Site próprio',
  fora_do_ar: 'Site fora do ar',
  sem_https: 'Sem HTTPS',
  certificado_invalido: 'Problema no certificado',
  verificar: 'Verificar',
}
const DECISAO_LABEL: Record<string, string> = {
  HAS_WEBSITE: 'Tem site', PROBABLY_NO_WEBSITE: 'Sem site (provável)', SOCIAL_ONLY: 'Só rede social', UNKNOWN: 'A confirmar', CONFLICT: 'Conflito',
}
const ANDAMENTO_LABEL: Record<string, string> = {
  PENDING: 'Na fila', PROCESSING: 'Processando', WAITING_QUOTA: 'Aguardando cota', WAITING_RETRY: 'Aguardando nova tentativa', DONE: 'Concluído', MANUAL_REVIEW: 'Revisão manual',
}
const CONTATO_LABEL: Record<string, string> = {
  nao_contatado: 'Não contatado', contato_1: 'Contato 1', contato_2: 'Contato 2', contato_3: 'Contato 3', sem_retorno: 'Sem retorno',
  negociando: 'Negociando', fechado: 'Fechado', recusado: 'Recusado',
}

const EXPORT_HEADERS = [
  'Nome', 'Cidade', 'Estado', 'Endereço', 'WhatsApp', 'Instagram', 'Site', 'Situação do site', 'Decisão do site', 'Confiança (heurística)', 'Andamento',
  'Avaliação', 'Nº de avaliações', 'Google Maps', 'Status de contato', 'Responsável', 'Notas',
]

// Neutraliza fórmulas (=, +, -, @) ao abrir no Excel — mesmo padrão do CSV de Bookings.
function safeCell(value: string): string {
  return /^[=+\-@]/.test(value) ? `'${value}` : value
}

// Exporta os leads de uma aba (respeitando os filtros da tela) em CSV ou XLSX.
export async function exportLeads(filters: LeadFilters, format: 'csv' | 'xlsx') {
  const nicho = await prisma.nicho.findUnique({ where: { id: filters.nichoId }, select: { nome: true } })
  if (!nicho) throw httpError(404, 'Aba não encontrada')

  const leads = await listLeads(filters)
  const rows: (string | number)[][] = leads.map((l) => [
    safeCell(l.arenaName),
    safeCell(l.city ?? ''),
    l.state ?? '',
    safeCell(l.address ?? ''),
    safeCell(l.whatsapp ?? ''),
    safeCell(l.instagramHandle ? `@${l.instagramHandle}` : l.instagram ?? ''),
    safeCell(l.siteUrl ?? l.website ?? l.foundWebsite ?? ''),
    SITE_LABEL[l.statusSite] ?? l.statusSite,
    DECISAO_LABEL[l.websiteStatus ?? ''] ?? 'Sem decisão',
    l.websiteConfidence != null && l.websiteStatus ? Math.round(l.websiteConfidence * 100) / 100 : '',
    ANDAMENTO_LABEL[l.investigationState ?? ''] ?? 'Não investigado',
    l.avaliacao ?? '',
    l.numAvaliacoes ?? '',
    l.googleMapsUrl ?? '',
    CONTATO_LABEL[l.status] ?? l.status,
    safeCell(l.responsavelNome ?? ''),
    safeCell(l.notes ?? ''),
  ])

  const slug = nicho.nome.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'leads'
  const filename = `leads-${slug}.${format}`

  if (format === 'csv') {
    const csv = [EXPORT_HEADERS, ...rows]
      .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))
      .join('\r\n')
    return { filename, contentType: 'text/csv; charset=utf-8', body: Buffer.from('﻿' + csv, 'utf-8') }
  }

  const workbook = new ExcelJS.Workbook()
  // Nome da aba do Excel: máx. 31 caracteres e sem \ / ? * [ ] :
  const sheet = workbook.addWorksheet(nicho.nome.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Leads')
  sheet.addRow(EXPORT_HEADERS).font = { bold: true }
  rows.forEach((r) => sheet.addRow(r))
  sheet.columns.forEach((col, i) => {
    const longest = Math.max(EXPORT_HEADERS[i].length, ...rows.map((r) => String(r[i]).length))
    col.width = Math.min(Math.max(longest + 2, 10), 50)
  })
  sheet.views = [{ state: 'frozen', ySplit: 1 }]
  const body = Buffer.from(await workbook.xlsx.writeBuffer())
  return { filename, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', body }
}

// "Tubarão - SC" → { city: 'Tubarão', state: 'SC' }
function splitCidade(cidade: string) {
  const m = cidade.match(/^(.*?)\s*[-/]\s*([A-Za-z]{2})$/)
  return m ? { city: m[1].trim(), state: m[2].toUpperCase() } : { city: cidade, state: null }
}

export async function buscarLeads(nichoId: string, cidadesInput: string) {
  const nicho = await prisma.nicho.findUnique({ where: { id: nichoId } })
  if (!nicho) throw httpError(404, 'Aba não encontrada')

  const cidades = parseCidades(cidadesInput)
  if (cidades.length === 0) throw httpError(400, 'Informe ao menos uma cidade')
  if (cidades.length > MAX_CIDADES) throw httpError(400, `Máximo de ${MAX_CIDADES} cidades por busca`)

  const found = new Map<string, PlaceResult & { city: string; state: string | null }>()
  let requestsRestantes = env.MAX_GOOGLE_REQUESTS_PER_SEARCH // teto por clique, somando todas as cidades
  const run = new QuotaRun('buscar', { GOOGLE_TEXT_SEARCH_PRO: Math.min(env.MAX_GOOGLE_REQUESTS_PER_SEARCH, env.GOOGLE_TEXT_SEARCH_PRO_MAX_CALLS_PER_RUN) })
  let chamadas = 0
  for (const cidade of cidades) {
    if (requestsRestantes <= 0) break
    const stats = newSearchStats()
    const places = await searchPlaces(nicho.nome, cidade, { termos: nicho.termosBusca ?? [], maxRequests: requestsRestantes, stats, run })
    requestsRestantes -= stats.calls
    chamadas += stats.calls
    await prisma.buscaLog.create({ data: { nichoId, cidade, numChamadas: stats.calls || 1, mock: env.PLACES_MOCK === 'true' } })
    for (const p of places) if (!found.has(p.placeId)) found.set(p.placeId, { ...p, ...splitCidade(cidade) })
  }

  // Deduplica por placeId contra o banco inteiro (qualquer aba).
  const existing = await prisma.prospect.findMany({
    where: { placeId: { in: [...found.keys()] } },
    select: { id: true, placeId: true, website: true },
  })
  const existingIds = new Set(existing.map((e) => e.placeId))

  // placeId que já existe: atualiza só o que vem do Google (telefone, endereço, site, nota).
  // Status, responsável, notas e vínculos com campanhas não são tocados.
  let atualizados = 0
  const reclassificar: string[] = []
  for (const row of existing) {
    const p = found.get(row.placeId as string)
    if (!p) continue
    const data = googleFieldsUpdate(p, row.website)
    const siteMudou = 'website' in data // só existe quando veio um site novo e diferente
    await prisma.prospect.update({
      where: { id: row.id },
      data: { ...data, ...(siteMudou ? { verificadoEm: null } : {}) }, // site novo: reclassifica
    })
    if (siteMudou) reclassificar.push(row.id)
    atualizados += 1
  }
  for (const id of reclassificar) await enqueueSiteClassify(id, true) // site novo no Google: refaz o que venceu (sempre sob orçamento)
  // Mesmo telefone com placeIds diferentes NÃO é descartado: os leads entram e são agrupados (ownerGroupId).
  const fresh = [...found.values()].filter((p) => !existingIds.has(p.placeId))

  const created = await prisma.prospect.createMany({
    skipDuplicates: true,
    data: fresh.map((p) => ({
      placeId: p.placeId,
      nichoId,
      arenaName: p.nome,
      address: p.endereco,
      addressComponents: (p.addressComponents ?? undefined) as object | undefined,
      ...phoneFields(p.telefoneInternacional, p.telefone),
      website: p.website,
      googleMapsUrl: p.googleMapsUri ?? null,
      primaryType: p.primaryType ?? null,
      avaliacao: p.avaliacao,
      numAvaliacoes: p.numAvaliacoes,
      city: p.city,
      // UF: a informada na busca ("Tubarão - SC") ou, sem ela, descoberta pelo endereço do Google / tabela do IBGE.
      state: p.state ?? inferState({ city: p.city, address: p.endereco, addressComponents: p.addressComponents }),
    })),
  })

  // Classificação de presença digital roda em background (fila com
  // concorrência limitada) — não trava a resposta da busca.
  const novosLeads = await prisma.prospect.findMany({
    where: { placeId: { in: fresh.map((p) => p.placeId) } },
    select: { id: true, placeId: true, phoneMobile: true, whatsapp: true, numAvaliacoes: true, avaliacao: true, instagramHandle: true },
  })
  // A descoberta (Text Search PRO) NÃO traz telefone, website, nota nem avaliações: lead novo fica AGUARDANDO o Place Details
  // (etapa Enterprise, orçamento próprio) e só é investigado quando priorizado no "Enriquecer". Ausência de website aqui
  // não é "sem site" — a decisão continua pendente (UNKNOWN) até o Details.
  await prisma.prospect.updateMany({
    where: { id: { in: novosLeads.map((l) => l.id) }, investigationState: null },
    data: { investigationState: 'PENDING', investigationNextRunAt: null, investigationNextAction: 'GOOGLE_DETAILS', investigationWaitReason: 'AWAITING_DETAILS_SELECTION' },
  })
  // Fluxo normal automático: depois da descoberta Pro, os melhores leads da aba entram direto no Details Enterprise, dentro do
  // lote por requisição, do saldo e do teto por execução. O que sobra fica aguardando (UNKNOWN, sem Tavily/Meta) até retomar.
  const sel = await selectLeadsForDetails({ nichoId, nichoTermos: [nicho.nome, ...(nicho.termosBusca ?? [])] })
  await enqueueDetails(sel.selecionados)

  return { cidades, encontrados: found.size, novos: created.count, duplicados: found.size - created.count, atualizados, chamadasGoogle: chamadas, details: detailsResumo(sel) }
}

// Só dígitos, pra comparar números digitados de formas diferentes (com/sem
// +55, espaços, traço) — mesmo padrão de client.service.ts normalizePhone.
function normalizePhone(v: string): string {
  return v.replace(/\D/g, '')
}

// Cria em lote a partir da prévia de importação (planilha) dentro de uma aba —
// pula linhas cujo WhatsApp (normalizado) já existe na base, tanto contra
// leads já cadastrados quanto entre linhas repetidas na própria planilha.
export async function importLeads(input: ImportLeadsInput) {
  const nicho = await prisma.nicho.findUnique({ where: { id: input.nichoId }, select: { id: true } })
  if (!nicho) throw httpError(404, 'Aba não encontrada')

  const existing = await prisma.prospect.findMany({ where: { whatsapp: { not: null } }, select: { whatsapp: true } })
  const seen = new Set(existing.map((p) => normalizePhone(p.whatsapp as string)))

  const toCreate: ImportLeadsInput['rows'] = []
  let skipped = 0
  for (const row of input.rows) {
    const key = normalizePhone(row.whatsapp)
    if (!key || seen.has(key)) {
      skipped += 1
      continue
    }
    seen.add(key)
    toCreate.push(row)
  }

  if (toCreate.length > 0) {
    await prisma.prospect.createMany({
      data: toCreate.map((row) => ({ ...row, ...phoneFields(null, row.whatsapp), whatsapp: row.whatsapp, nichoId: input.nichoId, state: (row as StateSource).state ?? inferState(row as StateSource) })),
    })
    // Classificação de presença digital roda em background.
    const criados = await prisma.prospect.findMany({
      where: { nichoId: input.nichoId, whatsapp: { in: toCreate.map((r) => r.whatsapp) } },
      select: { id: true },
    })
    await enqueueManySiteClassify(criados.map((l) => l.id))
  }
  return { created: toCreate.length, skipped }
}

// Força reclassificação de um lead (botão "reverificar" da UI), ignorando o
// cache de 30 dias.
export async function reverificarLead(id: string) {
  const lead = await prisma.prospect.findUnique({ where: { id }, select: { id: true } })
  if (!lead) throw httpError(404, 'Lead não encontrado')
  await enqueueSiteClassify(id, true)
}

type DetailsSel = Awaited<ReturnType<typeof selectLeadsForDetails>>
const detailsResumo = (sel: DetailsSel) => ({ selecionados: sel.selecionados.length, aguardando: sel.aguardando, ignorados: sel.ignorados, limiteAplicado: sel.limite, saldoDetails: sel.saldo, motivoEspera: sel.motivoEspera, retomarEm: sel.retomarEm })

// Botão "Enriquecer" (retomar): enfileira os leads do nicho (busca web + score).
// Respeita o cache de 30 dias — só enriquece quem ainda não foi enriquecido.
export async function enriquecerNicho(nichoId: string, opts: { limite?: number; ids?: string[] } = {}) {
  const nicho = await prisma.nicho.findUnique({ where: { id: nichoId }, select: { id: true, nome: true, termosBusca: true } })
  if (!nicho) throw httpError(404, 'Aba não encontrada')
  // Leads com placeId só entram na etapa Enterprise (Place Details) se PRIORIZADOS e dentro do saldo; os sem placeId
  // (planilha) seguem direto para a investigação (HTTP/Tavily/Meta), como antes.
  const sel = await selectLeadsForDetails({ nichoId, nichoTermos: [nicho.nome, ...(nicho.termosBusca ?? [])], ids: opts.ids, limite: opts.limite })
  const semPlace = await prisma.prospect.findMany({ where: { nichoId, placeId: null }, select: { id: true, phoneMobile: true, whatsapp: true, numAvaliacoes: true, avaliacao: true, instagramHandle: true } })
  await enqueueManySiteClassify(semPlace.map((l) => l.id), new Map(semPlace.map((l) => [l.id, leadPriority(l)])))
  await enqueueDetails(sel.selecionados)
  return { enfileirados: sel.selecionados.length + semPlace.length, buscaConfigurada: isSearchConfigured(), details: detailsResumo(sel) }
}
