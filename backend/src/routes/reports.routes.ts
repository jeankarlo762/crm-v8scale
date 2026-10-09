import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { authenticate, requireRole } from '../middlewares/auth'
import { httpError } from '../utils/errors'
import * as reports from '../services/reports.service'

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida (use AAAA-MM-DD)')
const periodQuery = z.object({ from: dateOnly.optional(), to: dateOnly.optional() })
const idQuery = z.string().trim().min(1).max(64).optional()

function period(q: z.infer<typeof periodQuery>) {
  if (q.from && q.to && q.from > q.to) throw httpError(400, 'O fim do período deve ser depois do início')
  return reports.parsePeriod(q.from, q.to)
}

/** Relatórios: ADMIN e MANAGER (mostram dados de todos os usuários). */
export async function reportRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate)
  app.addHook('preHandler', requireRole('ADMIN', 'MANAGER'))

  app.get('/campaigns', async (req, reply) => {
    const q = periodQuery.extend({ responsavelId: idQuery }).parse(req.query)
    return reply.send(await reports.campaignsReport({ ...period(q), responsavelId: q.responsavelId }))
  })

  app.get<{ Params: { id: string } }>('/campaigns/:id/recipients', async (req, reply) => {
    const { replied } = z.object({ replied: z.enum(['true', 'false']).default('false') }).parse(req.query)
    const out = await reports.campaignRecipientsReport(req.params.id, replied === 'true')
    if (!out) throw httpError(404, 'Campanha não encontrada')
    return reply.send(out)
  })

  app.get('/users', async (req, reply) => {
    return reply.send(await reports.usersReport(period(periodQuery.parse(req.query))))
  })

  app.get('/commercial', async (req, reply) => {
    const q = periodQuery.extend({ ownerId: idQuery }).parse(req.query)
    return reply.send(await reports.commercialReport({ ...period(q), ownerId: q.ownerId }))
  })

  app.get('/prospecting', async (req, reply) => {
    return reply.send(await reports.prospectingReport(period(periodQuery.parse(req.query))))
  })

  app.get('/funnel', async (req, reply) => {
    const q = periodQuery.extend({ ownerId: idQuery }).parse(req.query)
    return reply.send(await reports.funnelReport({ ...period(q), ownerId: q.ownerId }))
  })
}
