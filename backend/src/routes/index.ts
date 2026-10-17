import { FastifyInstance } from 'fastify'
import { authRoutes } from './auth.routes'
import { userRoutes } from './users.routes'
import { stageRoutes } from './stages.routes'
import { leadRoutes } from './leads.routes'
import { taskRoutes } from './tasks.routes'
import { customerRoutes } from './customers.routes'
import { dashboardRoutes } from './dashboard.routes'
import { leadRoutes as prospectRoutes, nichoRoutes } from './lead.routes'
import { campaignRoutes } from './campaign.routes'
import { goalRoutes } from './goals.routes'
import { reportRoutes } from './reports.routes'
import { financialRoutes } from './financial.routes'
import { contractRoutes } from './contracts.routes'
import { aiRoutes } from './ai.routes'
import { zapsignConfigRoutes, zapsignWebhookRoutes } from './zapsign.routes'

// Cada módulo novo entra aqui com o seu próprio prefixo (ex.: /api/<modulo>),
// mantendo auth/usuários compartilhados.
export async function registerRoutes(app: FastifyInstance) {
  app.register(authRoutes, { prefix: '/api/auth' })
  app.register(userRoutes, { prefix: '/api/users' })

  // ── Módulo Comercial ──
  app.register(stageRoutes, { prefix: '/api/commercial/stages' })
  app.register(leadRoutes, { prefix: '/api/commercial/leads' })
  app.register(taskRoutes, { prefix: '/api/commercial/tasks' })
  app.register(customerRoutes, { prefix: '/api/commercial/customers' })
  app.register(dashboardRoutes, { prefix: '/api/commercial/dashboard' })
  app.register(goalRoutes, { prefix: '/api/commercial/goals' })
  app.register(aiRoutes, { prefix: '/api/commercial/ai' })

  // ── Prospecção e campanhas de WhatsApp ──
  app.register(nichoRoutes, { prefix: '/api/commercial/nichos' })
  app.register(prospectRoutes, { prefix: '/api/commercial/prospects' })
  app.register(campaignRoutes, { prefix: '/api/commercial/campaigns' })

  // ── Relatórios (ADMIN/MANAGER) ──
  app.register(reportRoutes, { prefix: '/api/reports' })

  // ── Financeiro e Contratos (ADMIN/MANAGER) ──
  app.register(financialRoutes, { prefix: '/api/financial' })
  app.register(contractRoutes, { prefix: '/api/contracts' })
  app.register(zapsignConfigRoutes, { prefix: '/api/integrations/zapsign' })
  app.register(zapsignWebhookRoutes, { prefix: '/api/zapsign' })
}
