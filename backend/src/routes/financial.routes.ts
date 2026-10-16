import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { authenticate, requireRole } from '../middlewares/auth'
import { httpError } from '../utils/errors'
import { getFinancialOverview } from '../services/financial.service'

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida (use AAAA-MM-DD)')

/** Financeiro: ADMIN e MANAGER (receita de todos os clientes). */
export async function financialRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate)
  app.addHook('preHandler', requireRole('ADMIN', 'MANAGER'))

  app.get('/overview', async (req, reply) => {
    const q = z.object({ from: dateOnly, to: dateOnly }).parse(req.query)
    if (q.from > q.to) throw httpError(400, 'O fim do período deve ser depois do início')
    // Dias no fuso de Brasília; o fim é exclusivo (meia-noite do dia seguinte).
    const start = new Date(`${q.from}T00:00:00-03:00`)
    const end = new Date(new Date(`${q.to}T00:00:00-03:00`).getTime() + 86_400_000)
    return reply.send(await getFinancialOverview({ start, end }))
  })
}
