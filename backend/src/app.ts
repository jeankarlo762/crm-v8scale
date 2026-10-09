import Fastify, { FastifyInstance } from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import { env } from './config/env'
import { registerRoutes } from './routes'
import { errorHandler } from './middlewares/errorHandler'

/**
 * Monta a aplicação sem subir o servidor. Usado por server.ts (produção) e
 * pelos testes (app.inject), que assim exercitam exatamente a mesma pilha.
 */
export function buildApp(): FastifyInstance {
  const app = Fastify({
    // Logs ligados em todos os ambientes: sem eles não há como investigar um
    // incidente em produção. O header Authorization nunca é gravado.
    logger: {
      level: env.NODE_ENV === 'test' ? 'silent' : env.NODE_ENV === 'development' ? 'debug' : 'info',
      redact: { paths: ['req.headers.authorization', 'req.headers.cookie'], censor: '[redacted]' },
    },
    // trustProxy: 1 — confia só no primeiro proxy (borda do Railway) para obter o IP real
    // do cliente, sem aceitar X-Forwarded-For forjado (evita burlar o rate limit por IP).
    trustProxy: 1,
    // JSON normal é pequeno; a importação de prospects (até 5000 linhas) é a exceção.
    bodyLimit: 4 * 1024 * 1024,
  })

  app.register(helmet, { contentSecurityPolicy: false })
  app.register(rateLimit, { global: true, max: 300, timeWindow: '1 minute' })

  const allowedOrigins = env.CORS_ORIGINS ? env.CORS_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean) : null
  app.register(cors, { origin: allowedOrigins ?? true })

  registerRoutes(app)
  app.setErrorHandler(errorHandler)

  app.get('/health', { config: { rateLimit: false } }, async () => ({ status: 'ok', timestamp: new Date().toISOString() }))

  return app
}
