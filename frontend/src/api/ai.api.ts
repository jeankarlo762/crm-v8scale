import api from './axios'

const base = '/commercial/ai'

export interface WhatsAppInfo {
  status: 'disconnected' | 'connecting' | 'connected'
  qr: string | null
}

export type Distribution = 'ROUND_ROBIN' | 'RANDOM' | 'NONE'

export interface AiConfig {
  enabled: boolean
  storeName: string | null
  instructions: string | null
  model: string
  distribution: Distribution
  reviewLink: string | null
  reviewMessage: string | null
  reviewAutoSend: boolean
  apiKeyConfigured: boolean
  whatsapp: WhatsAppInfo
}

export type AiConfigInput = Partial<Pick<AiConfig, 'enabled' | 'storeName' | 'instructions' | 'model' | 'distribution' | 'reviewLink' | 'reviewMessage' | 'reviewAutoSend'>>

export async function getConfig(): Promise<AiConfig> {
  return (await api.get<AiConfig>(`${base}/config`)).data
}
export async function saveConfig(input: AiConfigInput): Promise<AiConfig> {
  return (await api.put<AiConfig>(`${base}/config`, input)).data
}
export async function getWhatsAppStatus(): Promise<WhatsAppInfo> {
  return (await api.get<WhatsAppInfo>(`${base}/whatsapp/status`)).data
}
export async function connectWhatsApp(): Promise<WhatsAppInfo> {
  return (await api.post<WhatsAppInfo>(`${base}/whatsapp/connect`)).data
}
export async function disconnectWhatsApp(): Promise<void> {
  await api.post(`${base}/whatsapp/disconnect`)
}

// ── Lead ──
export interface AiMessage { id: string; role: 'USER' | 'ASSISTANT'; content: string; createdAt: string }

export async function listMessages(leadId: string): Promise<AiMessage[]> {
  return (await api.get<AiMessage[]>(`${base}/leads/${leadId}/messages`)).data
}
export async function assumeLead(leadId: string): Promise<void> {
  await api.post(`${base}/leads/${leadId}/assume`)
}
/** Passa o lead para o próximo vendedor da fila (ou para `userId`, só gerente). */
export async function passLead(leadId: string, userId?: string): Promise<{ owner: { id: string; name: string } }> {
  return (await api.post(`${base}/leads/${leadId}/pass`, { userId: userId ?? null })).data
}
export async function sendReviewRequest(leadId: string): Promise<void> {
  await api.post(`${base}/leads/${leadId}/review-request`)
}

export interface AiAlert { id: string; name: string; phone: string | null; createdAt: string; owner: { id: string; name: string } | null }
export async function getAlerts(since?: string): Promise<{ now: string; leads: AiAlert[] }> {
  return (await api.get(`${base}/alerts`, { params: since ? { since } : {} })).data
}

// ── Catálogo ──
export type VehicleStatus = 'AVAILABLE' | 'RESERVED' | 'SOLD'
export interface Vehicle {
  id: string
  brand: string
  model: string
  version: string | null
  year: number | null
  price: number
  km: number | null
  color: string | null
  fuel: string | null
  transmission: string | null
  plate: string | null
  description: string | null
  photoUrl: string | null
  status: VehicleStatus
}
export type VehicleInput = Omit<Vehicle, 'id'>

export async function listVehicles(): Promise<Vehicle[]> {
  return (await api.get<Vehicle[]>(`${base}/vehicles`)).data
}
export async function createVehicle(input: VehicleInput): Promise<Vehicle> {
  return (await api.post<Vehicle>(`${base}/vehicles`, input)).data
}
export async function updateVehicle(id: string, input: Partial<VehicleInput>): Promise<Vehicle> {
  return (await api.patch<Vehicle>(`${base}/vehicles/${id}`, input)).data
}
export async function deleteVehicle(id: string): Promise<void> {
  await api.delete(`${base}/vehicles/${id}`)
}
