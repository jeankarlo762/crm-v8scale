import api from './axios'

export type ContractStatus = 'DRAFT' | 'SENT' | 'SIGNED' | 'CANCELLED'

export interface Contract {
  id: string
  customerId: string | null
  customer: { id: string; name: string } | null
  clientName: string
  clientDocument: string | null
  clientEmail: string | null
  clientPhone: string | null
  clientAddress: string | null
  title: string
  serviceObject: string | null
  monthlyValue: number
  setupFee: number
  paymentDay: number | null
  startDate: string | null
  durationMonths: number | null
  bodyText: string | null
  notes: string | null
  status: ContractStatus
  signed: boolean
  signedAt: string | null
  cancelledAt: string | null
  signUrl: string | null
  signedPdfUrl: string | null
  createdAt: string
}

export interface ContractInput {
  customerId?: string | null
  clientName: string
  clientDocument?: string | null
  clientEmail?: string | null
  clientPhone?: string | null
  clientAddress?: string | null
  title?: string
  serviceObject?: string | null
  monthlyValue?: number
  setupFee?: number
  paymentDay?: number | null
  startDate?: string | null
  durationMonths?: number | null
  bodyText?: string | null
  notes?: string | null
}

export interface ZapSignConfig {
  configured: boolean
  sandbox: boolean
  active: boolean
  webhookSecret: string
}

export async function listContracts(filters: { status?: ContractStatus; q?: string; customerId?: string } = {}): Promise<Contract[]> {
  const { data } = await api.get<Contract[]>('/contracts', { params: filters })
  return data
}

export async function getTemplate(params: { monthlyValue?: number; setupFee?: number; paymentDay?: number; durationMonths?: number; startDate?: string }): Promise<{ serviceObject: string; bodyText: string }> {
  const { data } = await api.get<{ serviceObject: string; bodyText: string }>('/contracts/template', { params })
  return data
}

export async function createContract(input: ContractInput): Promise<Contract> {
  const { data } = await api.post<Contract>('/contracts', input)
  return data
}

export async function updateContract(id: string, input: Partial<ContractInput>): Promise<Contract> {
  const { data } = await api.patch<Contract>(`/contracts/${id}`, input)
  return data
}

export async function deleteContract(id: string): Promise<void> {
  await api.delete(`/contracts/${id}`)
}

export async function sendContract(id: string): Promise<Contract> {
  const { data } = await api.post<Contract>(`/contracts/${id}/send`)
  return data
}

export async function markSigned(id: string): Promise<Contract> {
  const { data } = await api.post<Contract>(`/contracts/${id}/mark-signed`)
  return data
}

export async function cancelContract(id: string): Promise<Contract> {
  const { data } = await api.post<Contract>(`/contracts/${id}/cancel`)
  return data
}

export async function downloadContractPdf(id: string): Promise<void> {
  const res = await api.get<Blob>(`/contracts/${id}/pdf`, { responseType: 'blob' })
  const match = /filename="([^"]+)"/.exec(String(res.headers['content-disposition'] ?? ''))
  const url = URL.createObjectURL(res.data)
  const a = document.createElement('a')
  a.href = url
  a.download = match?.[1] ?? 'contrato.pdf'
  a.click()
  URL.revokeObjectURL(url)
}

export async function getZapSignConfig(): Promise<ZapSignConfig> {
  const { data } = await api.get<ZapSignConfig>('/integrations/zapsign')
  return data
}

export async function setZapSignConfig(input: { apiToken?: string; sandbox?: boolean; active?: boolean }): Promise<ZapSignConfig> {
  const { data } = await api.put<ZapSignConfig>('/integrations/zapsign', input)
  return data
}
