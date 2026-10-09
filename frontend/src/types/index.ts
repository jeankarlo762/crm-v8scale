export type Role = 'ADMIN' | 'MANAGER' | 'SELLER'

export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: 'Administrador',
  MANAGER: 'Gerente',
  SELLER: 'Vendedor',
}

export interface User {
  id: string
  name: string
  email: string
  phone?: string | null
  role: Role
  active: boolean
  createdAt: string
}

export type StoredUser = Pick<User, 'id' | 'name' | 'email' | 'role'>

export interface LoginResponse {
  accessToken: string
  refreshToken: string
  user: StoredUser
}

// ── Comercial ────────────────────────────────────────────────────────────────

export type StageKind = 'OPEN' | 'WON' | 'LOST'

export interface Stage {
  id: string
  name: string
  color: string
  position: number
  kind: StageKind
}

export interface UserRef {
  id: string
  name: string
}

export interface Lead {
  id: string
  name: string
  contactName: string | null
  email: string | null
  phone: string | null
  document: string | null
  city: string | null
  state: string | null
  source: string | null
  segment: string | null
  value: number
  notes: string | null
  lostReason: string | null
  archived: boolean
  expectedCloseAt: string | null
  stageId: string
  stage: Stage
  stageChangedAt: string
  ownerId: string | null
  owner: UserRef | null
  openTasks: number
  createdAt: string
  updatedAt: string
}

export type ActivityType = 'NOTE' | 'CALL' | 'WHATSAPP' | 'EMAIL' | 'MEETING' | 'STAGE_CHANGE' | 'OWNER_CHANGE'
/** Tipos que o usuário registra à mão (os demais o sistema gera). */
export type LoggableActivityType = Exclude<ActivityType, 'STAGE_CHANGE' | 'OWNER_CHANGE'>

export interface Activity {
  id: string
  leadId: string
  type: ActivityType
  content: string
  createdAt: string
  user: UserRef | null
}

export interface Task {
  id: string
  title: string
  dueAt: string
  done: boolean
  doneAt: string | null
  leadId: string | null
  lead: UserRef | null
  assigneeId: string | null
  assignee: UserRef | null
  createdAt: string
}

export interface LeadDetail extends Lead {
  activities: Activity[]
  tasks: Task[]
}

export interface LeadInput {
  name: string
  contactName?: string | null
  email?: string | null
  phone?: string | null
  document?: string | null
  city?: string | null
  state?: string | null
  source?: string | null
  segment?: string | null
  value?: number
  notes?: string | null
  expectedCloseAt?: string | null
  ownerId?: string | null
  stageId?: string
  archived?: boolean
}

export interface Customer {
  id: string
  leadId: string
  name: string
  contactName: string | null
  email: string | null
  phone: string | null
  document: string | null
  mrrValue: number
  setupFee: number
  active: boolean
  churnedAt: string | null
  archivedAt: string | null
  archiveReason: string | null
  notes: string | null
  createdAt: string
  lead: {
    id: string
    ownerId: string | null
    owner: UserRef | null
    source: string | null
    city: string | null
    state: string | null
  }
}

export interface DashboardData {
  days: number
  kpis: {
    openLeads: number
    pipelineValue: number
    newLeads: number
    wonCount: number
    wonValue: number
    lostCount: number
    conversionRate: number | null
    overdueTasks: number
    todayTasks: number
  }
  funnel: Array<{ id: string; name: string; color: string; kind: StageKind; count: number; value: number }>
  leadsPerDay: Array<{ date: string; count: number }>
  bySource: Array<{ source: string; count: number }>
  bySeller: Array<{
    id: string
    name: string
    wonCount: number
    wonValue: number
    openCount: number
    openValue: number
  }>
}

export const LEAD_SOURCES = [
  'Indicação',
  'Instagram',
  'Google',
  'WhatsApp',
  'Site',
  'Evento',
  'Prospecção ativa',
  'Outro',
] as const

export const ACTIVITY_LABELS: Record<ActivityType, string> = {
  NOTE: 'Anotação',
  CALL: 'Ligação',
  WHATSAPP: 'WhatsApp',
  EMAIL: 'E-mail',
  MEETING: 'Reunião',
  STAGE_CHANGE: 'Mudança de etapa',
  OWNER_CHANGE: 'Troca de responsável',
}
