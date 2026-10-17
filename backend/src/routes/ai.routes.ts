import { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { prisma } from '../config/database'
import { authenticate, isRestricted, requireAdmin, requireRole } from '../middlewares/auth'
import { httpError } from '../utils/errors'
import { audit } from '../utils/audit'
import { LIMITS, assertActiveUser, idParam, moneyField, optionalText, requiredText } from '../utils/validation'
import * as ai from '../services/ai-attendance.service'

const configSchema = z.object({
  enabled: z.boolean(),
  storeName: optionalText(LIMITS.short),
  instructions: optionalText(LIMITS.long),
  model: z.string().trim().min(1).max(80),
  distribution: z.enum(['ROUND_ROBIN', 'RANDOM', 'NONE']),
  reviewLink: z.string().trim().max(500).url('Link de avaliação inválido').nullish().or(z.literal('')).transform((v) => v || null),
  reviewMessage: optionalText(LIMITS.medium),
  reviewAutoSend: z.boolean(),
}).partial()

const vehicleShape = {
  brand: requiredText(LIMITS.short, 'Marca'),
  model: requiredText(LIMITS.short, 'Modelo'),
  version: optionalText(LIMITS.short),
  year: z.coerce.number().int().min(1950).max(2100).nullish(),
  price: moneyField,
  km: z.coerce.number().int().min(0).max(5_000_000).nullish(),
  color: optionalText(60),
  fuel: optionalText(60),
  transmission: optionalText(60),
  plate: optionalText(20),
  description: optionalText(LIMITS.long),
  photoUrl: optionalText(500),
  status: z.enum(['AVAILABLE', 'RESERVED', 'SOLD']),
}
const vehicleCreate = z.object({ ...vehicleShape, price: vehicleShape.price.default(0), status: vehicleShape.status.default('AVAILABLE') })
const vehicleUpdate = z.object(vehicleShape).partial()

const passSchema = z.object({ userId: z.string().min(1).max(64).nullish() })
const alertsQuery = z.object({ since: z.string().max(40).optional() })

function scope(request: FastifyRequest): Prisma.LeadWhereInput {
  return isRestricted(request) ? { ownerId: request.user.id } : {}
}

async function ensureVisible(request: FastifyRequest, leadId: string) {
  const lead = await prisma.lead.findFirst({ where: { id: leadId, ...scope(request) }, select: { id: true, ownerId: true } })
  if (!lead) throw httpError(404, 'Lead não encontrado')
  return lead
}

function serializeVehicle(v: Prisma.VehicleGetPayload<object>) {
  return { ...v, price: Number(v.price) }
}

export async function aiRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate)

  // ── Configuração ──
  app.get('/config', { preHandler: [requireRole('ADMIN', 'MANAGER')] }, async (_req, reply) => {
    const [cfg, wa] = await Promise.all([ai.getConfig(), ai.whatsappInfo().catch(() => ({ status: 'disconnected' as const, qr: null }))])
    return reply.send({ ...cfg, apiKeyConfigured: ai.aiConfigured(), whatsapp: wa })
  })

  app.put('/config', { preHandler: [requireAdmin] }, async (request, reply) => {
    const input = configSchema.parse(request.body)
    if (input.enabled) await ai.ensureStages()
    await ai.getConfig()
    const cfg = await prisma.aiConfig.update({ where: { id: 'default' }, data: input })
    audit('ai.config_updated', { by: request.user.id, enabled: cfg.enabled })
    return reply.send({ ...cfg, apiKeyConfigured: ai.aiConfigured(), whatsapp: await ai.whatsappInfo().catch(() => ({ status: 'disconnected' as const, qr: null })) })
  })

  app.get('/whatsapp/status', { preHandler: [requireAdmin] }, async (_req, reply) => reply.send(await ai.whatsappInfo()))
  app.post('/whatsapp/connect', { preHandler: [requireAdmin] }, async (_req, reply) => reply.send(await ai.connectWhatsApp()))
  app.post('/whatsapp/disconnect', { preHandler: [requireAdmin] }, async (_req, reply) => {
    await ai.disconnectWhatsApp()
    return reply.send({ success: true })
  })

  // ── Lead ──
  app.get('/leads/:id/messages', async (request, reply) => {
    const { id } = idParam.parse(request.params)
    await ensureVisible(request, id)
    return reply.send(await prisma.aiMessage.findMany({ where: { leadId: id }, orderBy: { createdAt: 'asc' }, take: 200 }))
  })

  app.post('/leads/:id/assume', async (request, reply) => {
    const { id } = idParam.parse(request.params)
    const lead = await prisma.lead.findUnique({ where: { id }, select: { ownerId: true } })
    if (!lead) throw httpError(404, 'Lead não encontrado')
    // Vendedor assume o que é dele ou o que está sem dono; passar o lead de outro vendedor é decisão do gerente.
    if (isRestricted(request) && lead.ownerId && lead.ownerId !== request.user.id) {
      throw httpError(403, 'Este lead está com outro vendedor')
    }
    await ai.assumeLead(id, request.user)
    return reply.send({ success: true })
  })

  app.post('/leads/:id/pass', async (request, reply) => {
    const { id } = idParam.parse(request.params)
    const { userId } = passSchema.parse(request.body ?? {})
    await ensureVisible(request, id)
    // Vendedor passa o lead para o próximo da fila; escolher a pessoa é do gerente.
    if (userId) {
      if (isRestricted(request)) throw httpError(403, 'Apenas gerentes escolhem o vendedor')
      await assertActiveUser(userId)
    }
    const dest = await ai.passLead(id, request.user, userId)
    return reply.send({ success: true, owner: { id: dest.id, name: dest.name } })
  })

  app.post('/leads/:id/review-request', async (request, reply) => {
    const { id } = idParam.parse(request.params)
    await ensureVisible(request, id)
    const result = await ai.sendReviewRequest(id, { force: true, byUserId: request.user.id })
    if (!result.ok) throw httpError(409, result.error ?? 'Não foi possível enviar o pedido de avaliação')
    return reply.send({ success: true })
  })

  // Novos leads em atendimento pela IA (popup do vendedor). O front consulta de tempo em tempo com `since`.
  app.get('/alerts', async (request, reply) => {
    const { since } = alertsQuery.parse(request.query)
    const from = since && !Number.isNaN(new Date(since).getTime()) ? new Date(since) : new Date(Date.now() - 60_000)
    const leads = await prisma.lead.findMany({
      where: { aiActive: true, archived: false, createdAt: { gt: from }, ...scope(request) },
      orderBy: { createdAt: 'asc' },
      take: 20,
      select: { id: true, name: true, phone: true, createdAt: true, owner: { select: { id: true, name: true } } },
    })
    return reply.send({ now: new Date().toISOString(), leads })
  })

  // ── Catálogo de veículos ──
  app.get('/vehicles', async (_req, reply) => {
    const list = await prisma.vehicle.findMany({ orderBy: [{ status: 'asc' }, { createdAt: 'desc' }] })
    return reply.send(list.map(serializeVehicle))
  })

  app.post('/vehicles', { preHandler: [requireRole('ADMIN', 'MANAGER')] }, async (request, reply) => {
    const input = vehicleCreate.parse(request.body)
    const v = await prisma.vehicle.create({ data: input })
    return reply.status(201).send(serializeVehicle(v))
  })

  app.patch('/vehicles/:id', { preHandler: [requireRole('ADMIN', 'MANAGER')] }, async (request, reply) => {
    const { id } = idParam.parse(request.params)
    const input = vehicleUpdate.parse(request.body)
    if (!(await prisma.vehicle.findUnique({ where: { id }, select: { id: true } }))) throw httpError(404, 'Veículo não encontrado')
    return reply.send(serializeVehicle(await prisma.vehicle.update({ where: { id }, data: input })))
  })

  app.delete('/vehicles/:id', { preHandler: [requireRole('ADMIN', 'MANAGER')] }, async (request, reply) => {
    const { id } = idParam.parse(request.params)
    if (!(await prisma.vehicle.findUnique({ where: { id }, select: { id: true } }))) throw httpError(404, 'Veículo não encontrado')
    await prisma.vehicle.delete({ where: { id } })
    return reply.send({ success: true })
  })
}
