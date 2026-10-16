import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { authenticate, requireRole } from '../middlewares/auth'
import { audit } from '../utils/audit'
import { LIMITS, emailField, idParam, moneyField, optionalText, requiredText } from '../utils/validation'
import * as contracts from '../services/contract.service'
import { DEFAULT_SERVICE_OBJECT, defaultContractBody } from '../services/contract-pdf.service'

const dateOnly = z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida'), z.literal(''), z.null()])
  .optional()
  .transform((v) => (v === undefined ? undefined : v || null))

const contractSchema = z.object({
  customerId: z.string().max(64).nullish().transform((v) => (v === undefined ? undefined : v || null)),
  clientName: requiredText(200, 'Nome do contratante'),
  clientDocument: optionalText(30),
  clientEmail: emailField,
  clientPhone: optionalText(40),
  clientAddress: optionalText(LIMITS.medium),
  title: requiredText(200, 'Título').optional(),
  serviceObject: optionalText(2000),
  monthlyValue: moneyField.optional(),
  setupFee: moneyField.optional(),
  paymentDay: z.coerce.number().int().min(1).max(31).nullish(),
  startDate: dateOnly,
  durationMonths: z.coerce.number().int().min(1).max(120).nullish(),
  bodyText: optionalText(20000),
  notes: optionalText(LIMITS.long),
})

/** Contratos: ADMIN e MANAGER. Gera o PDF e coleta a assinatura pelo ZapSign. */
export async function contractRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate)
  app.addHook('preHandler', requireRole('ADMIN', 'MANAGER'))

  app.get('/', async (req, reply) => {
    const q = z.object({
      status: z.enum(contracts.CONTRACT_STATUSES).optional(),
      q: z.string().trim().max(LIMITS.short).optional(),
      customerId: z.string().max(64).optional(),
    }).parse(req.query)
    return reply.send(await contracts.listContracts(q))
  })

  // Texto padrão das cláusulas, para o formulário mostrar e permitir partir dele.
  app.get('/template', async (req, reply) => {
    const q = z.object({
      monthlyValue: z.coerce.number().min(0).default(0),
      setupFee: z.coerce.number().min(0).default(0),
      paymentDay: z.coerce.number().int().min(1).max(31).optional(),
      durationMonths: z.coerce.number().int().min(1).max(120).optional(),
      startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      serviceObject: z.string().max(2000).optional(),
    }).parse(req.query)
    return reply.send({
      serviceObject: DEFAULT_SERVICE_OBJECT,
      bodyText: defaultContractBody({
        id: '', title: '', clientName: '',
        ...q,
        startDate: q.startDate ? new Date(`${q.startDate}T00:00:00Z`) : null,
      }),
    })
  })

  app.get('/:id', async (req, reply) => {
    const { id } = idParam.parse(req.params)
    return reply.send(await contracts.getContract(id))
  })

  app.post('/', async (req, reply) => {
    const input = contractSchema.parse(req.body)
    const c = await contracts.createContract(input, req.user.id)
    audit('contract.created', { contractId: c.id, by: req.user.id })
    return reply.status(201).send(c)
  })

  app.patch('/:id', async (req, reply) => {
    const { id } = idParam.parse(req.params)
    const input = contractSchema.partial().parse(req.body)
    return reply.send(await contracts.updateContract(id, input))
  })

  app.delete('/:id', async (req, reply) => {
    const { id } = idParam.parse(req.params)
    await contracts.deleteContract(id)
    audit('contract.deleted', { contractId: id, by: req.user.id })
    return reply.status(204).send()
  })

  app.get('/:id/pdf', async (req, reply) => {
    const { id } = idParam.parse(req.params)
    const { buffer, filename } = await contracts.generatePdf(id)
    return reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `attachment; filename="${filename}"`)
      .send(buffer)
  })

  app.post('/:id/send', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { id } = idParam.parse(req.params)
    const c = await contracts.sendForSignature(id)
    audit('contract.sent', { contractId: id, by: req.user.id })
    return reply.send(c)
  })

  app.post('/:id/mark-signed', async (req, reply) => {
    const { id } = idParam.parse(req.params)
    const c = await contracts.markSigned(id)
    audit('contract.marked_signed', { contractId: id, by: req.user.id })
    return reply.send(c)
  })

  app.post('/:id/cancel', async (req, reply) => {
    const { id } = idParam.parse(req.params)
    const c = await contracts.cancelContract(id)
    audit('contract.cancelled', { contractId: id, by: req.user.id })
    return reply.send(c)
  })
}
