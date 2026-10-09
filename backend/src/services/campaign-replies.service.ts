import { prisma } from '../config/database'

// A resposta só conta para a campanha se veio até 30 dias depois do envio (conversa antiga não é "resposta à campanha").
export const REPLY_WINDOW_DAYS = 30
const CAMPAIGN_WA_KEY = 'campaign-broadcast'

// Compara pelos 8 últimos dígitos: ignora DDI/DDD e o 9º dígito (o WhatsApp devolve o número com ou sem ele).
export const phoneKey = (v: string): string => v.replace(/\D/g, '').slice(-8)

/**
 * Atribui uma mensagem recebida ao envio de campanha mais recente para aquele telefone.
 * Devolve o id do destinatário atribuído, ou null se o número não recebeu campanha na janela.
 */
export async function registerReply(phoneDigits: string, at: Date = new Date()): Promise<string | null> {
  const key = phoneKey(phoneDigits)
  if (key.length < 8) return null
  const since = new Date(at.getTime() - REPLY_WINDOW_DAYS * 86_400_000)
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "CampaignRecipient"
    WHERE "status" = 'SENT' AND "sentAt" >= ${since} AND "sentAt" <= ${at}
      AND right(regexp_replace("phone", '\D', '', 'g'), 8) = ${key}
    ORDER BY "sentAt" DESC LIMIT 1`
  const id = rows[0]?.id
  if (!id) return null
  await prisma.$executeRaw`
    UPDATE "CampaignRecipient"
    SET "replyCount" = "replyCount" + 1, "lastReplyAt" = ${at}, "repliedAt" = COALESCE("repliedAt", ${at})
    WHERE "id" = ${id}`
  return id
}

let registered = false
/** Liga a captura de respostas ao WhatsApp da campanha (idempotente). */
export function startReplyTracking(): void {
  if (registered || process.env.VITEST) return
  registered = true
  // Import dinâmico: o Baileys depende de binário nativo que pode falhar em algumas plataformas (ver campaign.service.ts).
  import('./baileys.service')
    .then((baileys) => baileys.onIncomingMessage(async (tenantId, phone) => {
      if (tenantId !== CAMPAIGN_WA_KEY) return
      await registerReply(phone)
    }))
    .catch((err) => console.error('[Campaign] Rastreio de respostas indisponível:', err))
}
