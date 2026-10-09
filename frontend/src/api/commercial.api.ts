import api from './axios'
import type {
  Activity, Customer, DashboardData, Lead, LeadDetail, LeadInput, LoggableActivityType, Stage, StageKind, Task,
} from '../types'

const base = '/commercial'

// ── Funil ────────────────────────────────────────────────────────────────────
export async function listStages(): Promise<Stage[]> {
  const { data } = await api.get<Stage[]>(`${base}/stages`)
  return data
}

export async function createStage(input: { name: string; color?: string; kind?: StageKind }): Promise<Stage> {
  const { data } = await api.post<Stage>(`${base}/stages`, input)
  return data
}

export async function updateStage(id: string, input: { name?: string; color?: string; kind?: StageKind }): Promise<Stage> {
  const { data } = await api.patch<Stage>(`${base}/stages/${id}`, input)
  return data
}

export async function reorderStages(ids: string[]): Promise<Stage[]> {
  const { data } = await api.put<Stage[]>(`${base}/stages/reorder`, { ids })
  return data
}

export async function deleteStage(id: string): Promise<void> {
  await api.delete(`${base}/stages/${id}`)
}

// ── Leads ────────────────────────────────────────────────────────────────────
export interface LeadFilters {
  q?: string
  stageId?: string
  /** id do usuário, ou 'none' para leads sem responsável */
  ownerId?: string
  source?: string
  archived?: boolean
}

export async function listLeads(filters: LeadFilters = {}): Promise<Lead[]> {
  const params: Record<string, string> = {}
  if (filters.q) params.q = filters.q
  if (filters.stageId) params.stageId = filters.stageId
  if (filters.ownerId) params.ownerId = filters.ownerId
  if (filters.source) params.source = filters.source
  if (filters.archived) params.archived = 'true'
  const { data } = await api.get<Lead[]>(`${base}/leads`, { params })
  return data
}

export async function getLead(id: string): Promise<LeadDetail> {
  const { data } = await api.get<LeadDetail>(`${base}/leads/${id}`)
  return data
}

export async function createLead(input: LeadInput): Promise<Lead> {
  const { data } = await api.post<Lead>(`${base}/leads`, input)
  return data
}

export async function updateLead(id: string, input: Partial<LeadInput>): Promise<Lead> {
  const { data } = await api.patch<Lead>(`${base}/leads/${id}`, input)
  return data
}

/** Troca o responsável do lead (null = sem responsável). Só gerente/admin. */
export async function changeLeadOwner(id: string, ownerId: string | null): Promise<Lead> {
  const { data } = await api.patch<Lead>(`${base}/leads/${id}/owner`, { ownerId })
  return data
}

/** Atribui vários leads ao mesmo responsável. Só gerente/admin. */
export async function bulkChangeLeadOwner(ids: string[], ownerId: string | null): Promise<{ updated: number }> {
  const { data } = await api.patch<{ updated: number }>(`${base}/leads/bulk-owner`, { ids, ownerId })
  return data
}

export async function changeLeadStage(id: string, stageId: string, lostReason?: string): Promise<Lead> {
  const { data } = await api.patch<Lead>(`${base}/leads/${id}/stage`, { stageId, lostReason })
  return data
}

export async function addActivity(id: string, type: LoggableActivityType, content: string): Promise<Activity> {
  const { data } = await api.post<Activity>(`${base}/leads/${id}/activities`, { type, content })
  return data
}

export async function deleteLead(id: string): Promise<void> {
  await api.delete(`${base}/leads/${id}`)
}

// ── Tarefas ──────────────────────────────────────────────────────────────────
export async function listTasks(params: { status?: 'open' | 'done' | 'all'; mine?: boolean } = {}): Promise<Task[]> {
  const { data } = await api.get<Task[]>(`${base}/tasks`, {
    params: { status: params.status ?? 'open', mine: params.mine ? 'true' : 'false' },
  })
  return data
}

export async function createTask(input: {
  title: string
  dueAt: string
  leadId?: string | null
  assigneeId?: string | null
}): Promise<Task> {
  const { data } = await api.post<Task>(`${base}/tasks`, input)
  return data
}

export async function updateTask(id: string, input: { title?: string; dueAt?: string; done?: boolean }): Promise<Task> {
  const { data } = await api.patch<Task>(`${base}/tasks/${id}`, input)
  return data
}

export async function deleteTask(id: string): Promise<void> {
  await api.delete(`${base}/tasks/${id}`)
}

// ── Clientes ─────────────────────────────────────────────────────────────────
export async function listCustomers(q?: string, archived = false): Promise<Customer[]> {
  const { data } = await api.get<Customer[]>(`${base}/customers`, { params: { ...(q ? { q } : {}), ...(archived ? { archived: 'true' } : {}) } })
  return data
}

export async function archiveCustomer(id: string, reason?: string): Promise<Customer> {
  const { data } = await api.post<Customer>(`${base}/customers/${id}/archive`, { reason: reason?.trim() || null })
  return data
}

export async function unarchiveCustomer(id: string): Promise<Customer> {
  const { data } = await api.post<Customer>(`${base}/customers/${id}/unarchive`)
  return data
}

export async function updateCustomer(
  id: string,
  input: Partial<Pick<Customer, 'name' | 'contactName' | 'email' | 'phone' | 'document' | 'mrrValue' | 'setupFee' | 'active' | 'notes'>>,
): Promise<Customer> {
  const { data } = await api.patch<Customer>(`${base}/customers/${id}`, input)
  return data
}

// ── Dashboard ────────────────────────────────────────────────────────────────
export async function getDashboard(days: number): Promise<DashboardData> {
  const { data } = await api.get<DashboardData>(`${base}/dashboard/commercial`, { params: { days } })
  return data
}

// ── Metas ────────────────────────────────────────────────────────────────────
export type GoalMetric = 'WON_VALUE' | 'WON_COUNT' | 'LEADS_CREATED' | 'ACTIVITIES'
export type GoalPeriodFilter = 'current' | 'past' | 'upcoming' | 'all'

export interface Goal {
  id: string
  title: string | null
  metric: GoalMetric
  target: number
  /** Valor atingido até agora, calculado pelo servidor a partir dos leads. */
  current: number
  percent: number
  periodStart: string
  periodEnd: string
  status: 'UPCOMING' | 'ACTIVE' | 'ENDED'
  ownerId: string | null
  owner: { id: string; name: string } | null
  notes: string | null
  createdAt: string
}

export interface GoalInput {
  title?: string | null
  metric: GoalMetric
  target: number
  /** AAAA-MM-DD */
  periodStart: string
  periodEnd: string
  /** null = meta da equipe */
  ownerId?: string | null
  notes?: string | null
}

export async function listGoals(params: { period?: GoalPeriodFilter; ownerId?: string } = {}): Promise<Goal[]> {
  const { data } = await api.get<Goal[]>(`${base}/goals`, { params: { period: params.period ?? 'current', ...(params.ownerId && { ownerId: params.ownerId }) } })
  return data
}

export async function createGoal(input: GoalInput): Promise<Goal> {
  const { data } = await api.post<Goal>(`${base}/goals`, input)
  return data
}

export async function updateGoal(id: string, input: Partial<GoalInput>): Promise<Goal> {
  const { data } = await api.patch<Goal>(`${base}/goals/${id}`, input)
  return data
}

export async function deleteGoal(id: string): Promise<void> {
  await api.delete(`${base}/goals/${id}`)
}
