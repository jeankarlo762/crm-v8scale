import { assertActiveUser } from '../utils/validation'
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { authenticate, requireRole } from '../middlewares/auth'

// Prospecção e campanhas: gerentes e administradores (vendedor não acessa).
const requireSuperAdmin = requireRole('ADMIN', 'MANAGER')
import * as campaignService from '../services/campaign.service'
import { createCampaignSchema, reviewAudienceSchema, updateCampaignSchema } from '../schemas/campaign.schema'

export async function campaignRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate)
  app.addHook('preHandler', requireSuperAdmin)

  // WhatsApp da campanha (conexão própria, não-oficial via QR — ver
  // campaign.service.ts CAMPAIGN_WA_KEY)
  app.get('/whatsapp/status', async (_req: FastifyRequest, reply: FastifyReply) => {
    return reply.send(await campaignService.getWhatsAppStatus())
  })

  app.post('/whatsapp/connect', async (_req: FastifyRequest, reply: FastifyReply) => {
    return reply.send(await campaignService.connectWhatsApp())
  })

  app.post('/whatsapp/disconnect', async (_req: FastifyRequest, reply: FastifyReply) => {
    await campaignService.disconnectWhatsApp()
    return reply.status(204).send()
  })

  app.get('/', async (_req: FastifyRequest, reply: FastifyReply) => {
    return reply.send(await campaignService.listCampaigns())
  })

  app.post('/', async (req: FastifyRequest, reply: FastifyReply) => {
    const input = createCampaignSchema.parse(req.body)
    await assertActiveUser(input.responsavelId)
    return reply.status(201).send(await campaignService.createCampaign(input))
  })

  app.get<{ Params: { id: string } }>('/:id', async (req, reply: FastifyReply) => {
    return reply.send(await campaignService.getCampaign(req.params.id))
  })

  app.put<{ Params: { id: string } }>('/:id', async (req, reply: FastifyReply) => {
    const input = updateCampaignSchema.parse(req.body)
    await assertActiveUser(input.responsavelId)
    return reply.send(await campaignService.updateCampaign(req.params.id, input))
  })

  app.delete<{ Params: { id: string } }>('/:id', async (req, reply: FastifyReply) => {
    await campaignService.deleteCampaign(req.params.id)
    return reply.status(204).send()
  })

  app.post<{ Params: { id: string } }>('/:id/start', async (req, reply: FastifyReply) => {
    return reply.send(await campaignService.startCampaign(req.params.id))
  })

  app.post<{ Params: { id: string } }>('/:id/review-audience', async (req, reply: FastifyReply) => {
    const { publico } = reviewAudienceSchema.parse(req.body)
    return reply.send(await campaignService.reviewCampaignAudience(req.params.id, publico))
  })

  app.post<{ Params: { id: string } }>('/:id/pause', async (req, reply: FastifyReply) => {
    return reply.send(await campaignService.pauseCampaign(req.params.id))
  })
}
