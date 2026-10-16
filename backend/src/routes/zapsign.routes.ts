import crypto from 'node:crypto'
import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { authenticate, requireAdmin } from '../middlewares/auth'
import { audit } from '../utils/audit'
import { handleWebhook } from '../services/contract.service'
import * as zapsign from '../services/zapsign.service'

/** Configuração do ZapSign (tela Integrações): só ADMIN. */
export async function zapsignConfigRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate)
  app.addHook('preHandler', requireAdmin)

  app.get('/', async (_req, reply) => reply.send(await zapsign.getConfig()))

  app.put('/', async (req, reply) => {
    const input = z.object({
      apiToken: z.string().max(400).optional(),
      sandbox: z.boolean().optional(),
      active: z.boolean().optional(),
    }).parse(req.body)
    const cfg = await zapsign.setConfig(input)
    audit('integration.zapsign.updated', { by: req.user.id, tokenChanged: !!input.apiToken?.trim() })
    return reply.send(cfg)
  })
}

// Webhook PÚBLICO do ZapSign: dá baixa automática quando o cliente assina. Quem chama se autentica pelo
// segredo no path (configurado no painel do ZapSign); sem ele o evento é ignorado.
export async function zapsignWebhookRoutes(app: FastifyInstance) {
  app.post<{ Params: { secret: string } }>(
    '/webhook/:secret',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (request, reply) => {
      try {
        const expected = await zapsign.getWebhookSecret()
        const provided = Buffer.from(request.params.secret ?? '')
        const known = Buffer.from(expected ?? '')
        if (!expected || provided.length !== known.length || !crypto.timingSafeEqual(provided, known)) {
          return reply.send({ ok: false })
        }
        return reply.send({ ok: true, ...(await handleWebhook(request.body)) })
      } catch (err) {
        request.log.error({ err }, '[ZapSign] erro no webhook')
        // Sempre 200, para o ZapSign não reenviar sem fim.
        return reply.send({ ok: false })
      }
    },
  )
}
