import api from './axios'
import type { StatusContato } from './lead.api'

export type CampaignStatus = 'DRAFT' | 'RUNNING' | 'PAUSED' | 'DONE'
export type RecipientStatus = 'PENDING' | 'SENT' | 'FAILED' | 'SKIPPED' // SKIPPED: o lead perdeu a elegibilidade "só sem site" depois da inclusão

export interface CampaignRecipientCounts {
  PENDING: number
  SENT: number
  FAILED: number
  SKIPPED?: number
  total: number
}

export interface Campaign {
  id: string
  name: string
  messages: string[]
  targetStatus: StatusContato
  nichoId: string | null
  nichoNome: string | null
  estado: string | null
  cidade: string | null
  limite: number | null
  selecionados?: boolean // true: leads escolhidos um a um na Prospecção (filtros não valem)
  publico?: string // 'todos' | 'sem_site' | 'legacy_unverified' (campanha antiga, público ainda não revisado)
  // Responsável pela campanha: os prospects contatados herdam o responsável.
  responsavelId: string | null
  responsavel: { id: string; name: string } | null
  delayMinSec: number
  delayMaxSec: number
  status: CampaignStatus
  createdAt: string
  updatedAt: string
  counts: CampaignRecipientCounts
}

export interface CampaignRecipient {
  id: string
  campaignId: string
  prospectId: string | null
  name: string
  phone: string
  status: RecipientStatus
  messageUsed: string | null
  sentAt: string | null
  error: string | null
  createdAt: string
}

export interface CampaignDetail extends Campaign {
  recipients: CampaignRecipient[]
}

export interface WhatsAppInfo {
  status: 'disconnected' | 'connecting' | 'connected'
  qr: string | null
}

export async function getWhatsAppStatus(): Promise<WhatsAppInfo> {
  const res = await api.get<WhatsAppInfo>('/commercial/campaigns/whatsapp/status')
  return res.data
}

export async function connectWhatsApp(): Promise<WhatsAppInfo> {
  const res = await api.post<WhatsAppInfo>('/commercial/campaigns/whatsapp/connect')
  return res.data
}

export async function disconnectWhatsApp(): Promise<void> {
  await api.post('/commercial/campaigns/whatsapp/disconnect')
}

export async function listCampaigns(): Promise<Campaign[]> {
  const res = await api.get<Campaign[]>('/commercial/campaigns')
  return res.data
}

export async function getCampaign(id: string): Promise<CampaignDetail> {
  const res = await api.get<CampaignDetail>(`/commercial/campaigns/${id}`)
  return res.data
}

export async function createCampaign(data: {
  name: string
  responsavelId: string
  messages: string[]
  targetStatus: StatusContato
  nichoId?: string | null
  estado?: string | null
  cidade?: string | null
  limite: number
  delaySec: number
  prospectIds?: string[] // seleção individual vinda da Prospecção (ignora status/nicho/estado/cidade/limite)
  publico?: 'todos' | 'sem_site' // 'sem_site': só decisão de ausência de site com confiança mínima (UNKNOWN/CONFLICT nunca entram)
}): Promise<CampaignDetail> {
  const res = await api.post<CampaignDetail>('/commercial/campaigns', data)
  return res.data
}

export async function updateCampaign(id: string, data: Parameters<typeof createCampaign>[0]): Promise<CampaignDetail> {
  const res = await api.put<CampaignDetail>(`/commercial/campaigns/${id}`, data)
  return res.data
}

export async function deleteCampaign(id: string): Promise<void> {
  await api.delete(`/commercial/campaigns/${id}`)
}

export async function startCampaign(id: string): Promise<Campaign> {
  const res = await api.post<Campaign>(`/commercial/campaigns/${id}/start`)
  return res.data
}

export async function pauseCampaign(id: string): Promise<Campaign> {
  const res = await api.post<Campaign>(`/commercial/campaigns/${id}/pause`)
  return res.data
}
