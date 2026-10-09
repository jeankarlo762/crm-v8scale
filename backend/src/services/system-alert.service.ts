import { prisma } from '../config/database'

// Registro de falhas de envio (WhatsApp/e-mail) para o admin conseguir ver e
// agir depois — hoje essas falhas só apareciam no log do servidor. Best-effort:
// uma falha ao gravar o alerta nunca deve derrubar o fluxo de envio original.
export interface CreateSystemAlertInput {
  tenantId: string | null
  channel: 'WHATSAPP' | 'EMAIL'
  context: string
  recipient?: string | null
  error: string
}

export async function createSystemAlert(input: CreateSystemAlertInput): Promise<void> {
  try {
    await prisma.systemAlert.create({
      data: {
        tenantId: input.tenantId,
        channel: input.channel,
        context: input.context,
        recipient: input.recipient ?? null,
        error: input.error,
      },
    })
  } catch (err) {
    console.error('[SystemAlert] Falha ao registrar alerta:', err)
  }
}
