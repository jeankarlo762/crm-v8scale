import api from './axios'
import type { UserRef } from '../types'

export interface FinancialOverview {
  totals: {
    mrr: number
    arr: number
    activeCustomers: number
    averageTicket: number
    setupRevenue: number
    newCustomers: number
    newMrr: number
    churnedCustomers: number
    churnedMrr: number
  }
  series: { month: string; mrr: number; setupRevenue: number; newCustomers: number; churned: number }[]
  bySeller: { ownerId: string | null; name: string; customers: number; mrr: number }[]
  customers: {
    id: string
    name: string
    active: boolean
    archived: boolean
    mrrValue: number
    setupFee: number
    createdAt: string
    churnedAt: string | null
    owner: UserRef | null
  }[]
}

export async function getOverview(from: string, to: string): Promise<FinancialOverview> {
  const { data } = await api.get<FinancialOverview>('/financial/overview', { params: { from, to } })
  return data
}
