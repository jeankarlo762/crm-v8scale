import api from './axios'

export interface PeriodParams { from?: string; to?: string }

// ── Campanhas ────────────────────────────────────────────────────────────────
export interface CampaignAgg {
  total: number; sent: number; failed: number; skipped: number; pending: number
  replied: number; replies: number; negotiating: number; closed: number
  leads: number; leadsWon: number; wonValue: number
  firstSentAt: string | null; lastSentAt: string | null
  replyRate: number; conversionRate: number
}
export interface CampaignReportRow extends CampaignAgg {
  id: string; name: string; status: string; nicho: string | null
  estado: string | null; cidade: string | null; selecionados: boolean; createdAt: string
  responsavel: { id: string; name: string } | null
}
export interface CampaignsReport {
  totals: CampaignAgg & { campaigns: number }
  campaigns: CampaignReportRow[]
  byUser: (CampaignAgg & { userId: string | null; name: string; campaigns: number })[]
  series: { day: string; enviadas: number; respostas: number }[]
}
export interface CampaignRecipientRow {
  id: string; name: string; phone: string; status: string
  sentAt: string | null; repliedAt: string | null; lastReplyAt: string | null; replyCount: number
  error: string | null; skipReason: string | null
  prospect: null | {
    id: string; arenaName: string; city: string | null; state: string | null; status: string
    convertedLead: null | { id: string; value: number; stage: { name: string; kind: string } }
  }
}

export async function campaignsReport(p: PeriodParams & { responsavelId?: string }): Promise<CampaignsReport> {
  return (await api.get('/reports/campaigns', { params: p })).data
}
export async function campaignRecipients(id: string, replied: boolean): Promise<{ campaign: { id: string; name: string }; recipients: CampaignRecipientRow[] }> {
  return (await api.get(`/reports/campaigns/${id}/recipients`, { params: { replied } })).data
}

// ── Usuários ─────────────────────────────────────────────────────────────────
export interface UserReportRow {
  id: string; name: string; email: string; phone: string | null; role: 'ADMIN' | 'MANAGER' | 'SELLER'; active: boolean
  createdAt: string; updatedAt: string; lastActivityAt: string | null
  leads: { owned: number; open: number; openValue: number; created: number; won: number; wonValue: number; lost: number; winRate: number }
  activities: { total: number; byType: Record<string, number> }
  tasks: { open: number; overdue: number; done: number }
  prospects: { total: number; negotiating: number; closed: number; refused: number }
  campaigns: { count: number; sent: number; replied: number; replyRate: number }
  goalsActive: number
}
export interface UsersReport {
  totals: { users: number; active: number; byRole: Record<'ADMIN' | 'MANAGER' | 'SELLER', number> }
  users: UserReportRow[]
}
export async function usersReport(p: PeriodParams): Promise<UsersReport> {
  return (await api.get('/reports/users', { params: p })).data
}

// ── Comercial ────────────────────────────────────────────────────────────────
export interface CommercialGroup { key: string; label: string; created: number; won: number; lost: number; wonValue: number; openCount: number; openValue: number; winRate: number }
export interface CommercialReport {
  kpis: {
    created: number; won: number; lost: number; wonValue: number; avgTicket: number; winRate: number; avgCycleDays: number
    openCount: number; openValue: number; activeCustomers: number; mrr: number; newCustomers: number; churned: number
  }
  bySource: CommercialGroup[]
  byOwner: CommercialGroup[]
  lostReasons: { reason: string; count: number }[]
  recentWins: { id: string; name: string; value: number; source: string | null; owner: string | null; closedAt: string }[]
  series: { day: string; criados: number; ganhos: number; valor: number }[]
}
export async function commercialReport(p: PeriodParams & { ownerId?: string }): Promise<CommercialReport> {
  return (await api.get('/reports/commercial', { params: p })).data
}

// ── Prospecção ───────────────────────────────────────────────────────────────
export interface CountRow { key: string; label: string; count: number }
export interface ProspectingReport {
  totals: {
    prospects: number; inPeriod: number; withWhatsapp: number; contacted: number; replied: number
    negotiating: number; closed: number; converted: number; searches: number; apiCalls: number
  }
  funnel: CountRow[]
  byStatus: CountRow[]
  bySite: CountRow[]
  byWebsiteDecision: CountRow[]
  byState: CountRow[]
  byNicho: { key: string; label: string; total: number; withWhatsapp: number; contacted: number; negotiating: number; closed: number; converted: number }[]
  byResponsavel: { key: string; label: string; total: number; contacted: number; negotiating: number; closed: number }[]
  series: { day: string; novos: number }[]
}
export async function prospectingReport(p: PeriodParams): Promise<ProspectingReport> {
  return (await api.get('/reports/prospecting', { params: p })).data
}

// ── Funil ────────────────────────────────────────────────────────────────────
export interface FunnelStageRow {
  id: string; name: string; color: string; kind: 'OPEN' | 'WON' | 'LOST'; position: number
  count: number; value: number; share: number; avgDaysInStage: number; stuck: number; enteredInPeriod: number
}
export interface FunnelReport {
  totals: { leads: number; open: number; openValue: number; won: number; lost: number; stuck: number; stuckDays: number; movesInPeriod: number }
  stages: FunnelStageRow[]
  owners: { key: string; label: string; total: number; byStage: Record<string, number> }[]
}
export async function funnelReport(p: PeriodParams & { ownerId?: string }): Promise<FunnelReport> {
  return (await api.get('/reports/funnel', { params: p })).data
}
