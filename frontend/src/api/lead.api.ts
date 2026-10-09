import api from './axios'

export type StatusSite =
  | 'sem_site' | 'so_instagram' | 'so_facebook' | 'link_bio' | 'so_ota' | 'site_proprio' | 'fora_do_ar' | 'sem_https' | 'certificado_invalido' | 'verificar'
// Decisão (o que sabemos sobre o site) e andamento (em que ponto a investigação está) são eixos SEPARADOS.
export type WebsiteStatus = 'HAS_WEBSITE' | 'PROBABLY_NO_WEBSITE' | 'SOCIAL_ONLY' | 'UNKNOWN' | 'CONFLICT'
export type InvestigationState = 'PENDING' | 'PROCESSING' | 'WAITING_QUOTA' | 'WAITING_RETRY' | 'DONE' | 'MANUAL_REVIEW'
export type DecisionFilter = WebsiteStatus | 'SEM_DECISAO'
export type ProgressFilter = InvestigationState | 'LEGADO'

export interface WebsiteEvidenceItem { source: string; type: string; value: string | null; confidence: number; at?: string; fromCache?: boolean }
export interface WebsiteCoverage {
  sources?: Record<string, string>
  queries?: { key: string; state: string; results: number; at: string; fromCache: boolean }[]
  remaining?: { action: string; key: string; paid: boolean }[]
  blocked?: { step: string; code: string; detail: string }[]
  candidates?: { url: string; source: string; linkage: string; health: string | null; at: string | null; fromCache: boolean }[]
  calls?: { tavily: number; meta: number; cacheHits: number; pageFetches: number }
  calibrated?: boolean
  at?: string
}
export interface WebsiteConfirmation { url: string | null; valid: boolean; source: string | null; confirmedAt: string | null; revalidatedAt: string | null; invalidReason?: string | null; legacy?: boolean }

export type SiteHealth = 'ok' | 'fora_do_ar' | 'sem_https' | 'dominio_parado' | 'certificado_invalido'

export interface LinksEncontrados {
  instagram?: string
  whatsapp?: string
  linktree?: string
  booking?: string
  outros?: string[]
}
export type StatusContato =
  | 'nao_contatado' | 'contato_1' | 'contato_2' | 'contato_3' | 'sem_retorno' | 'negociando' | 'fechado' | 'recusado'

// Responsável = id de um usuário do CRM (o backend devolve também responsavelNome).
export type Responsavel = string

export interface Nicho {
  id: string
  nome: string
  createdAt: string
}

export interface Lead {
  id: string
  placeId: string | null
  nichoId: string | null
  arenaName: string
  city: string | null
  state: string | null
  address: string | null
  whatsapp: string | null
  phoneE164: string | null
  phoneCountry: string | null
  phoneMobile: boolean | null
  ownerGroupSize?: number
  ownerGroupNames?: string[]
  instagram: string | null
  website: string | null
  destinoReal: string | null
  siteUrl: string | null
  linksEncontrados: LinksEncontrados | null
  fonte: 'maps' | 'linktree' | null
  verificadoEm: string | null
  statusSite: StatusSite
  siteStatus: SiteHealth | null
  siteCheckReason: string | null
  foundSiteCheckReason: string | null
  instagramHandle: string | null
  foundWebsite: string | null
  instagramVerificar: boolean
  foundWebsiteVerificar: boolean
  foundSiteStatus: SiteHealth | null
  foundWebsiteSource: 'busca' | 'link_na_bio' | 'instagram' | 'manual' | null
  instagramFollowers: number | null
  instagramMediaCount: number | null
  businessDiscoveryCheckedAt: string | null
  instagramManual: boolean
  siteManual: boolean
  enrichedAt: string | null
  enrichError: string | null
  leadScore: number
  websiteStatus: WebsiteStatus | null
  websiteConfidence: number | null // heurística, não é probabilidade calibrada
  websiteReason: string | null
  websiteDecidedAt: string | null
  websiteEvidence: WebsiteEvidenceItem[] | null
  websiteCoverage: WebsiteCoverage | null
  websiteConfirmation: WebsiteConfirmation | null
  confirmedWebsite: string | null
  investigationState: InvestigationState | null
  investigationNextAction: string | null
  investigationNextRunAt: string | null
  investigationWaitReason: string | null
  investigationAttempts: number
  investigationLastError: string | null
  avaliacao: number | null
  numAvaliacoes: number | null
  googleMapsUrl: string | null
  status: StatusContato
  notes: string | null
  responsavel: Responsavel | null
  responsavelNome: string | null
  convertedLeadId: string | null
  createdAt: string
}

export interface DetailsResumo { selecionados: number; aguardando: number; ignorados: { duplicados: number; jaComDetails: number }; limiteAplicado: number; saldoDetails: number | null; motivoEspera: 'SALDO' | 'LOTE' | null; retomarEm: string | null }
export interface BuscaResultado {
  cidades: string[]
  encontrados: number
  novos: number
  duplicados: number
  atualizados: number
  details?: DetailsResumo
}

export async function listNichos(): Promise<Nicho[]> {
  const res = await api.get<Nicho[]>('/commercial/nichos')
  return res.data
}

export async function createNicho(nome: string): Promise<Nicho> {
  const res = await api.post<Nicho>('/commercial/nichos', { nome })
  return res.data
}

export async function deleteNicho(id: string): Promise<void> {
  await api.delete(`/commercial/nichos/${id}`)
}

// Cidades que têm lead — de um nicho ou de todos (sem nichoId).
export async function listCidades(nichoId?: string, estado?: string): Promise<string[]> {
  const res = await api.get<string[]>('/commercial/prospects/cidades', { params: { ...(nichoId ? { nichoId } : {}), ...(estado ? { estado } : {}) } })
  return res.data
}

export async function listEstados(nichoId?: string): Promise<string[]> {
  const res = await api.get<string[]>('/commercial/prospects/estados', { params: nichoId ? { nichoId } : {} })
  return res.data
}

export async function listLeads(nichoId: string): Promise<Lead[]> {
  const res = await api.get<Lead[]>('/commercial/prospects', { params: { nichoId } })
  return res.data
}

// Exclui vários leads de uma vez; devolve quantos foram removidos.
export async function deleteLeads(ids: string[]): Promise<number> {
  const res = await api.post<{ deleted: number }>('/commercial/prospects/delete-many', { ids })
  return res.data.deleted
}

// Baixa a planilha dos leads da aba (respeitando os filtros informados).
export async function exportLeads(
  nichoId: string,
  format: 'csv' | 'xlsx',
  filters: {
    statusSite?: StatusSite[]
    status?: StatusContato
    cidade?: string
    estado?: string
    avaliacaoMin?: number
    numAvaliacoesMin?: number
    numAvaliacoesMax?: number
    somenteCelular?: boolean
    responsavel?: Responsavel | 'nenhum'
    decisao?: DecisionFilter[]
    andamento?: ProgressFilter[]
  } = {},
): Promise<void> {
  const { statusSite, decisao, andamento, ...rest } = filters
  const res = await api.get<Blob>('/commercial/prospects/export', {
    params: { nichoId, format, ...rest, ...(statusSite?.length ? { statusSite: statusSite.join(',') } : {}), ...(decisao?.length ? { decisao: decisao.join(',') } : {}), ...(andamento?.length ? { andamento: andamento.join(',') } : {}) },
    responseType: 'blob',
  })
  const match = /filename="([^"]+)"/.exec(String(res.headers['content-disposition'] ?? ''))
  const url = URL.createObjectURL(res.data)
  const a = document.createElement('a')
  a.href = url
  a.download = match?.[1] ?? `leads.${format}`
  a.click()
  URL.revokeObjectURL(url)
}

export async function buscarLeads(nichoId: string, cidades: string): Promise<BuscaResultado> {
  const res = await api.post<BuscaResultado>('/commercial/prospects/buscar', { nichoId, cidades })
  return res.data
}

export async function updateLead(id: string, data: { status?: StatusContato; notes?: string | null; responsavel?: Responsavel | null; foundWebsite?: string | null; instagramHandle?: string | null }): Promise<Lead> {
  const res = await api.patch<Lead>(`/commercial/prospects/${id}`, data)
  return res.data
}

// Força reclassificação da presença digital do lead (ignora cache de 30 dias).
export async function reverificarLead(id: string): Promise<void> {
  await api.post(`/commercial/prospects/${id}/reverificar`)
}

// Botão "Enriquecer" da aba: busca web + health check + score em segundo plano.
export interface EnriquecerResultado { enfileirados: number; buscaConfigurada: boolean; details?: DetailsResumo }
/** Preenche a UF dos prospects sem estado (endereço do Google / tabela do IBGE pela cidade). */
export async function preencherEstados(): Promise<{ scanned: number; filled: number; unresolved: number }> {
  const res = await api.post<{ scanned: number; filled: number; unresolved: number }>('/commercial/prospects/preencher-estados')
  return res.data
}

export async function enriquecerNicho(nichoId: string): Promise<EnriquecerResultado> {
  const res = await api.post<EnriquecerResultado>('/commercial/prospects/enriquecer', { nichoId })
  return res.data
}

export async function bulkUpdateStatus(ids: string[], status: StatusContato): Promise<{ updated: number }> {
  const res = await api.patch<{ updated: number }>('/commercial/prospects/bulk-status', { ids, status })
  return res.data
}

export async function bulkUpdateResponsavel(ids: string[], responsavel: Responsavel | null): Promise<{ updated: number }> {
  const res = await api.patch<{ updated: number }>('/commercial/prospects/bulk-responsavel', { ids, responsavel })
  return res.data
}

export interface Quota {
  usadas: number
  limite: number | null // null = orçamento mensal do Google não configurado (provedor bloqueado)
}

export interface ConsumoJanela { usado: number; orcamento: number | null; efetivo: number | null; saldo: number | null; proximoReset?: string | null }
export interface ConsumoProvedor {
  configurado: boolean
  bloqueio: { code: string; detail: string; retryAt: string | null } | null
  janelas: Record<'H' | 'M', ConsumoJanela>
  capGratuitoDocumentado: number | null
  nota?: string
}
export interface Consumo {
  usage: Record<'GOOGLE_TEXT_SEARCH_PRO' | 'GOOGLE_PLACE_DETAILS_ENTERPRISE' | 'TAVILY' | 'META', ConsumoProvedor>
  metrics: { callsSavedByCache: number; callsSavedByShortCircuit: number; callsSkippedByQuota: number; callsReserved: number }
  limitacoes: string[]
  integracoes: { provider: string; reason: string | null; since: string }[]
  atualizadoEm: string
}

export async function getConsumo(): Promise<Consumo> {
  const res = await api.get<Consumo>('/commercial/prospects/consumo')
  return res.data
}

// Credencial corrigida: retoma a integração pausada e acorda os leads que esperavam por ela.
export async function retomarIntegracao(provider: string): Promise<{ retomado: string; acordados: number }> {
  const res = await api.post<{ retomado: string; acordados: number }>(`/commercial/prospects/integracoes/${provider}/retomar`)
  return res.data
}

export async function getQuota(): Promise<Quota> {
  const res = await api.get<Quota>('/commercial/prospects/quota')
  return res.data
}

export interface BuscaRecente {
  cidade: string
  diasAtras: number
}

export async function buscasRecentes(nichoId: string, cidades: string): Promise<BuscaRecente[]> {
  const res = await api.get<BuscaRecente[]>('/commercial/prospects/buscas-recentes', { params: { nichoId, cidades } })
  return res.data
}

// Linha vinda da prévia de importação (planilha .csv/.xlsx) — ainda editável
// antes de confirmar; `warnings` sinaliza o que faltou reconhecer na coluna.
export interface ImportLeadRow {
  arenaName: string
  state: string | null
  city: string | null
  address: string | null
  contactName: string | null
  whatsapp: string
  instagram: string | null
  website: string | null
  googleMapsUrl: string | null
  sports: string | null
  courtsInfo: string | null
  currentSystem: string | null
  warnings: string[]
}

export interface ImportPreviewResult {
  rows: ImportLeadRow[]
  totalRows: number
  truncated: boolean
}

export async function importLeadsPreview(file: File): Promise<ImportPreviewResult> {
  const formData = new FormData()
  formData.append('file', file)
  const res = await api.post<ImportPreviewResult>('/commercial/prospects/import-preview', formData, {
    headers: { 'Content-Type': undefined },
  })
  return res.data
}

export async function importLeads(nichoId: string, rows: ImportLeadRow[]): Promise<{ created: number; skipped: number }> {
  const res = await api.post<{ created: number; skipped: number }>('/commercial/prospects/import', {
    nichoId,
    rows: rows.map(({ warnings: _warnings, ...rest }) => rest),
  })
  return res.data
}

/** Converte o prospect em lead do funil comercial (idempotente: repetir devolve o lead já criado). */
export async function convertProspect(id: string): Promise<{ created: boolean; leadId: string; name: string }> {
  const res = await api.post<{ created: boolean; leadId: string; name: string }>(`/commercial/prospects/${id}/convert`)
  return res.data
}
