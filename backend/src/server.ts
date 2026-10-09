import { env } from './config/env'
import { prisma } from './config/database'
import { buildApp } from './app'
import { initSeedIfNeeded } from './seed'
import { startInvestigationWorker, stopInvestigationWorker } from './services/site-classify-queue.service'
import { backfillProspectStates } from './services/geo-uf.service'

const app = buildApp()

async function start() {
  try {
    await initSeedIfNeeded(prisma)
    await app.listen({ port: env.PORT, host: '0.0.0.0' })
    app.log.info(`CRM V8 Scale rodando na porta ${env.PORT} (${env.NODE_ENV})`)
    startInvestigationWorker() // fila persistente da investigação de site da Prospecção
    // Prospects antigos sem UF ganham a UF pela cidade (uma passada rápida, só nas linhas sem estado).
    backfillProspectStates()
      .then((r) => { if (r.scanned) app.log.info(`[prospeccao] UF preenchida em ${r.filled} de ${r.scanned} prospects sem estado`) })
      .catch((err) => app.log.warn({ err }, '[prospeccao] falha ao preencher UFs'))
  } catch (err) {
    app.log.error(err)
    await prisma.$disconnect()
    process.exit(1)
  }
}

async function shutdown() {
  stopInvestigationWorker()
  await app.close()
  await prisma.$disconnect()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

start()
