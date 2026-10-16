import crypto from 'node:crypto'
import { prisma } from '../config/database'
import { env } from '../config/env'
import { decryptSecret, encryptSecret } from '../utils/crypto'
import { httpError } from '../utils/errors'

// Integração com o ZapSign (assinatura eletrônica). O token é salvo pelo ADMIN na tela Integrações
// (criptografado no banco); ZAPSIGN_API_TOKEN é a alternativa por variável. Docs: https://docs.zapsign.com.br/

const CONFIG_ID = 'default'
const PROD_URL = 'https://api.zapsign.com.br/api/v1'
const SANDBOX_URL = 'https://sandbox.api.zapsign.com.br/api/v1'

function getRow() {
  return prisma.zapSignConfig.findUnique({ where: { id: CONFIG_ID } })
}

async function getToken(): Promise<string | null> {
  const row = await getRow()
  if (row?.active === false) return null
  if (row?.apiTokenEnc) return decryptSecret(row.apiTokenEnc)
  return env.ZAPSIGN_API_TOKEN ?? null
}

async function getBaseUrl(): Promise<string> {
  const row = await getRow()
  if (row?.apiTokenEnc) return row.sandbox ? SANDBOX_URL : PROD_URL
  return env.ZAPSIGN_BASE_URL
}

// Segredo que vai no path do webhook (…/api/zapsign/webhook/<segredo>) e autentica quem chama.
// Gerado uma única vez e guardado criptografado.
async function ensureWebhookSecret(): Promise<string> {
  const row = await getRow()
  if (row?.webhookSecretEnc) return decryptSecret(row.webhookSecretEnc)
  const secret = crypto.randomBytes(24).toString('hex')
  await prisma.zapSignConfig.upsert({
    where: { id: CONFIG_ID },
    create: { id: CONFIG_ID, webhookSecretEnc: encryptSecret(secret) },
    update: { webhookSecretEnc: encryptSecret(secret) },
  })
  return secret
}

export async function getWebhookSecret(): Promise<string | null> {
  const row = await getRow()
  return row?.webhookSecretEnc ? decryptSecret(row.webhookSecretEnc) : null
}

/** Configuração para a tela (nunca devolve o token). */
export async function getConfig() {
  const row = await getRow()
  return {
    configured: !!row?.apiTokenEnc || !!env.ZAPSIGN_API_TOKEN,
    sandbox: row?.sandbox ?? false,
    active: row?.active ?? true,
    webhookSecret: await ensureWebhookSecret(),
  }
}

export async function setConfig(data: { apiToken?: string; sandbox?: boolean; active?: boolean }) {
  const update: { apiTokenEnc?: string; sandbox?: boolean; active?: boolean } = {}
  if (data.apiToken?.trim()) update.apiTokenEnc = encryptSecret(data.apiToken.trim())
  if (data.sandbox !== undefined) update.sandbox = data.sandbox
  if (data.active !== undefined) update.active = data.active
  await prisma.zapSignConfig.upsert({ where: { id: CONFIG_ID }, create: { id: CONFIG_ID, ...update }, update })
  return getConfig()
}

interface CreateDocInput {
  name: string
  base64Pdf: string
  signerName: string
  signerEmail?: string | null
  signerPhone?: string | null
  externalId: string
}

/** Cria o documento no ZapSign a partir do PDF; o ZapSign envia o link ao signatário por e-mail/WhatsApp. */
export async function createDocument(input: CreateDocInput): Promise<{ token: string; signUrl: string | null }> {
  const token = await getToken()
  if (!token) throw httpError(400, 'ZapSign não configurado: salve o token em Integrações')
  const baseUrl = await getBaseUrl()
  // O segredo precisa existir antes do primeiro envio, senão o webhook de assinatura seria rejeitado.
  await ensureWebhookSecret()

  const signer: Record<string, unknown> = { name: input.signerName, send_automatic_email: !!input.signerEmail }
  if (input.signerEmail) signer.email = input.signerEmail
  if (input.signerPhone) {
    signer.phone_country = '55'
    signer.phone_number = input.signerPhone.replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '')
    signer.send_automatic_whatsapp = true
  }

  const res = await fetch(`${baseUrl}/docs/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      name: input.name,
      base64_pdf: input.base64Pdf,
      external_id: input.externalId,
      lang: 'pt-br',
      signers: [signer],
    }),
    signal: AbortSignal.timeout(30_000),
  })
  const json = (await res.json().catch(() => ({}))) as {
    token?: string
    signers?: { sign_url?: string }[]
    message?: string
    error?: string
    detail?: string
  }
  if (!res.ok || !json.token) {
    throw httpError(502, `ZapSign recusou o envio: ${json.message || json.error || json.detail || `HTTP ${res.status}`}`)
  }
  return { token: json.token, signUrl: json.signers?.[0]?.sign_url ?? null }
}

export interface ZapSignWebhook {
  token?: string
  externalId?: string
  signedFileUrl?: string
  isSigned: boolean
}

export function parseWebhook(body: unknown): ZapSignWebhook {
  const b = (body ?? {}) as Record<string, unknown>
  const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined)
  const signedFileUrl = str(b.signed_file) ?? str(b.signed_file_url)
  const isSigned = b.status === 'signed' || b.event_type === 'doc_signed' || !!signedFileUrl
  return { token: str(b.token), externalId: str(b.external_id), signedFileUrl, isSigned }
}
