import { Prisma } from '@prisma/client'
import { prisma } from '../config/database'
import { env } from '../config/env'
import { httpError } from '../utils/errors'
import { phoneKey } from './campaign-replies.service'

// Conexão de WhatsApp (Baileys) da IA: é o número principal da loja. O vendedor NÃO atende por aqui — ele chama o lead
// pelo próprio celular (link wa.me com a abertura sugerida pela IA).
export const AI_WA_KEY = 'ai-attendance'

const AI_STAGE_NAME = 'Atendimento IA'
const SELLER_STAGE_NAME = 'Atendimento do vendedor'
const HISTORY_LIMIT = 24
const DEFAULT_REVIEW_MESSAGE = 'Obrigado pela confiança! Se puder, avalie nosso atendimento com 5 estrelas, leva menos de 1 minuto: {link}'

export type Distribution = 'ROUND_ROBIN' | 'RANDOM' | 'NONE'

export interface Qualification {
  interest: string | null // carro/categoria que procura
  budget: string | null
  tradeIn: string | null // carro na troca
  financing: string | null // financiamento / à vista
  timeline: string | null // urgência
  summary: string | null // resumo de 1-2 frases para o vendedor
  openingMessage: string | null // frase pronta para o vendedor iniciar a conversa
  ready: boolean // lead já qualificado: vale o vendedor assumir
}

export const EMPTY_QUALIFICATION: Qualification = {
  interest: null, budget: null, tradeIn: null, financing: null, timeline: null, summary: null, openingMessage: null, ready: false,
}

// ── Configuração ─────────────────────────────────────────────────────────────

export async function getConfig() {
  return prisma.aiConfig.upsert({ where: { id: 'default' }, create: { id: 'default' }, update: {} })
}

/** Cria (uma vez) as duas primeiras etapas do funil e guarda os ids na configuração. Idempotente. */
export async function ensureStages() {
  const cfg = await getConfig()
  const existing = await prisma.stage.findMany({ where: { id: { in: [cfg.aiStageId, cfg.sellerStageId].filter((v): v is string => !!v) } } })
  let aiStageId = existing.find((s) => s.id === cfg.aiStageId)?.id
  let sellerStageId = existing.find((s) => s.id === cfg.sellerStageId)?.id
  if (aiStageId && sellerStageId) return { aiStageId, sellerStageId }

  await prisma.$transaction(async (tx) => {
    const missing = [!aiStageId, !sellerStageId].filter(Boolean).length
    // As novas etapas entram no começo do funil; as demais descem.
    await tx.stage.updateMany({ data: { position: { increment: missing } } })
    if (!aiStageId) aiStageId = (await tx.stage.create({ data: { name: AI_STAGE_NAME, color: '#8b5cf6', kind: 'OPEN', position: 0 } })).id
    if (!sellerStageId) sellerStageId = (await tx.stage.create({ data: { name: SELLER_STAGE_NAME, color: '#0ea5e9', kind: 'OPEN', position: aiStageId && missing === 2 ? 1 : 0 } })).id
    await tx.aiConfig.update({ where: { id: 'default' }, data: { aiStageId, sellerStageId } })
  })
  return { aiStageId: aiStageId!, sellerStageId: sellerStageId! }
}

export function aiConfigured(): boolean {
  return !!env.ANTHROPIC_API_KEY
}

// ── Distribuição entre vendedores ────────────────────────────────────────────

/** Próximo vendedor da fila (ou sorteado). `exclude` evita devolver quem acabou de passar o lead adiante. */
export async function pickSeller(distribution: Distribution, opts: { exclude?: string | null; advance?: boolean } = {}): Promise<string | null> {
  if (distribution === 'NONE') return null
  const sellers = await prisma.user.findMany({
    where: { active: true, role: 'SELLER', ...(opts.exclude ? { id: { not: opts.exclude } } : {}) },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  })
  if (sellers.length === 0) return null
  if (distribution === 'RANDOM') return sellers[Math.floor(Math.random() * sellers.length)].id

  const cfg = await getConfig()
  const last = sellers.findIndex((s) => s.id === cfg.lastAssignedUserId)
  const next = sellers[(last + 1) % sellers.length].id // last = -1 (não está na lista) → primeiro da fila
  if (opts.advance !== false) await prisma.aiConfig.update({ where: { id: 'default' }, data: { lastAssignedUserId: next } })
  return next
}

// ── Lead ↔ telefone ──────────────────────────────────────────────────────────

async function findLeadByPhone(phoneDigits: string): Promise<{ id: string; aiActive: boolean; aiMessageCount: number; name: string } | null> {
  const key = phoneKey(phoneDigits)
  if (key.length < 8) return null
  const rows = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT "id" FROM "Lead"
    WHERE "archived" = false AND "phone" IS NOT NULL
      AND right(regexp_replace("phone", '[^0-9]', '', 'g'), 8) = ${key}
    ORDER BY "createdAt" DESC LIMIT 1`)
  if (!rows[0]) return null
  return prisma.lead.findUnique({ where: { id: rows[0].id }, select: { id: true, aiActive: true, aiMessageCount: true, name: true } })
}

// ── Claude ───────────────────────────────────────────────────────────────────

interface ChatTurn { role: 'user' | 'assistant'; content: string }

async function vehiclesContext(): Promise<string> {
  const vehicles = await prisma.vehicle.findMany({ where: { status: 'AVAILABLE' }, orderBy: { createdAt: 'desc' }, take: 80 })
  if (vehicles.length === 0) return 'ESTOQUE: nenhum veículo cadastrado no momento. Não invente carros; diga que o vendedor confirma a disponibilidade.'
  const lines = vehicles.map((v) => {
    const parts = [
      `${v.brand} ${v.model}${v.version ? ` ${v.version}` : ''}`,
      v.year ? String(v.year) : null,
      v.km != null ? `${v.km.toLocaleString('pt-BR')} km` : null,
      v.color, v.fuel, v.transmission,
      Number(v.price) > 0 ? `R$ ${Number(v.price).toLocaleString('pt-BR')}` : 'preço a consultar',
      v.description,
    ].filter(Boolean)
    return `- ${parts.join(' | ')}`
  })
  return `ESTOQUE ATUAL (únicos carros que você pode oferecer):\n${lines.join('\n')}`
}

function systemPrompt(cfg: { storeName: string | null; instructions: string | null }, stock: string, current: Qualification): string {
  return [
    `Você é a assistente de pré-atendimento de ${cfg.storeName || 'uma loja de veículos'}, conversando por WhatsApp com um cliente que acabou de chegar de um anúncio.`,
    'Seu papel é de SDR: responder rápido, tirar as dúvidas iniciais sobre os carros e descobrir o que o cliente procura. Um vendedor humano vai assumir depois.',
    '',
    'REGRAS',
    '- Português do Brasil, tom simpático e direto, mensagens curtas (1 a 3 frases), no estilo do WhatsApp. No máximo um emoji.',
    '- Use SOMENTE as informações do estoque abaixo. Nunca invente preço, quilometragem, condição de pagamento, desconto ou disponibilidade; se não souber, diga que o vendedor confirma.',
    '- Sempre termine com UMA pergunta que mantenha a conversa andando (carro de interesse, orçamento, carro na troca, financiamento ou à vista, prazo para fechar).',
    '- Não peça dados sensíveis (CPF, senha, cartão). Não negocie preço nem prometa aprovação de crédito.',
    '- Se o cliente pedir para falar com uma pessoa, diga que já avisou o vendedor e que ele chama em instantes.',
    '- Se receber áudio, imagem ou figurinha sem texto, peça gentilmente para o cliente escrever.',
    cfg.instructions ? `\nINSTRUÇÕES DA LOJA\n${cfg.instructions}` : '',
    '',
    stock,
    '',
    `O QUE JÁ SE SABE DO CLIENTE (atualize conforme ele responder): ${JSON.stringify(current)}`,
    '',
    'FORMATO DA RESPOSTA: devolva APENAS um objeto JSON, sem markdown, com as chaves:',
    '{"reply": string, "interest": string|null, "budget": string|null, "tradeIn": string|null, "financing": string|null, "timeline": string|null, "summary": string|null, "openingMessage": string|null, "ready": boolean}',
    '- reply: a mensagem que vai para o cliente.',
    '- summary: 1-2 frases para o vendedor com o que o cliente quer.',
    '- openingMessage: frase pronta, em primeira pessoa do vendedor, para ele iniciar a conversa pelo próprio WhatsApp (cite o carro de interesse e o que o cliente já contou).',
    '- ready: true quando já souber o carro de interesse e ao menos mais um item entre orçamento, troca, financiamento ou prazo, ou quando o cliente pedir um humano.',
    '- Mantenha o valor anterior de um campo quando o cliente não trouxe novidade sobre ele.',
  ].filter((l) => l !== '').join('\n')
}

interface AiTurnResult { reply: string; qualification: Qualification }

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, 600) : null
}

export function parseAiTurn(raw: string, previous: Qualification): AiTurnResult | null {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  let obj: Record<string, unknown>
  try { obj = JSON.parse(raw.slice(start, end + 1)) } catch { return null }
  const reply = str(obj.reply)
  if (!reply) return null
  const pick = (k: keyof Qualification) => str(obj[k]) ?? (previous[k] as string | null)
  return {
    reply,
    qualification: {
      interest: pick('interest'), budget: pick('budget'), tradeIn: pick('tradeIn'), financing: pick('financing'),
      timeline: pick('timeline'), summary: pick('summary'), openingMessage: pick('openingMessage'),
      ready: obj.ready === true || previous.ready,
    },
  }
}

async function askClaude(model: string, system: string, turns: ChatTurn[]): Promise<string> {
  const res = await fetch(`${env.ANTHROPIC_BASE_URL.replace(/\/$/, '')}/v1/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY!, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model, max_tokens: 700, system, messages: turns }),
    signal: AbortSignal.timeout(30_000),
  })
  if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${(await res.text()).slice(0, 300)}`)
  const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> }
  return data.content?.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('') ?? ''
}

// ── Fluxo de mensagem recebida ───────────────────────────────────────────────

// Uma conversa por vez por telefone: mensagens em sequência do mesmo cliente não geram respostas em paralelo.
const queues = new Map<string, Promise<void>>()

export function handleIncoming(phoneDigits: string, text: string | null, pushName: string | null): Promise<void> {
  const key = phoneKey(phoneDigits)
  const run = (queues.get(key) ?? Promise.resolve()).then(() => processIncoming(phoneDigits, text, pushName)).catch((err) => {
    console.error('[IA] Falha no atendimento:', err)
  })
  queues.set(key, run)
  void run.finally(() => { if (queues.get(key) === run) queues.delete(key) })
  return run
}

async function processIncoming(phoneDigits: string, text: string | null, pushName: string | null): Promise<void> {
  const cfg = await getConfig()
  if (!cfg.enabled || !cfg.aiStageId || !aiConfigured()) return

  let lead = await findLeadByPhone(phoneDigits)
  if (!lead) {
    const ownerId = await pickSeller(cfg.distribution as Distribution)
    const created = await prisma.lead.create({
      data: {
        name: pushName || `+${phoneDigits}`,
        contactName: pushName,
        phone: `+${phoneDigits}`,
        source: 'WhatsApp (IA)',
        stageId: cfg.aiStageId,
        ownerId,
        aiActive: true,
        aiQualification: EMPTY_QUALIFICATION as unknown as Prisma.InputJsonValue,
        activities: { create: { type: 'NOTE', content: 'Lead entrou pelo WhatsApp e está em atendimento pela IA' } },
      },
      select: { id: true, aiActive: true, aiMessageCount: true, name: true },
    })
    lead = created
  }
  // Lead que já existe e não está com a IA (vendedor assumiu, ou veio de outra origem): quem atende é o vendedor.
  if (!lead.aiActive) return
  if (lead.aiMessageCount >= env.AI_MAX_REPLIES_PER_LEAD) return

  const content = text ?? '[o cliente enviou uma mídia sem texto]'
  await prisma.aiMessage.create({ data: { leadId: lead.id, role: 'USER', content } })

  const history = await prisma.aiMessage.findMany({ where: { leadId: lead.id }, orderBy: { createdAt: 'desc' }, take: HISTORY_LIMIT })
  const turns: ChatTurn[] = history.reverse().map((m) => ({ role: m.role === 'USER' ? 'user' : 'assistant', content: m.content }))
  while (turns.length && turns[0].role !== 'user') turns.shift()

  const fresh = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id }, select: { aiQualification: true, aiActive: true } })
  const previous = { ...EMPTY_QUALIFICATION, ...((fresh.aiQualification as Partial<Qualification> | null) ?? {}) }

  const raw = await askClaude(cfg.model, systemPrompt(cfg, await vehiclesContext(), previous), turns)
  const turn = parseAiTurn(raw, previous)
  if (!turn) throw new Error(`Resposta da IA fora do formato: ${raw.slice(0, 200)}`)

  // O vendedor pode ter assumido enquanto a IA pensava: nesse caso a resposta não sai.
  const still = await prisma.lead.findUnique({ where: { id: lead.id }, select: { aiActive: true } })
  if (!still?.aiActive) return

  const baileys = await import('./baileys.service')
  const sent = await baileys.sendMessage(AI_WA_KEY, phoneDigits, turn.reply)
  if (!sent.ok) return

  await prisma.$transaction([
    prisma.aiMessage.create({ data: { leadId: lead.id, role: 'ASSISTANT', content: turn.reply } }),
    prisma.lead.update({
      where: { id: lead.id },
      data: { aiQualification: turn.qualification as unknown as Prisma.InputJsonValue, aiMessageCount: { increment: 1 } },
    }),
  ])
}

let registered = false
/** Liga a IA às mensagens recebidas no WhatsApp da loja (idempotente). */
export function startAiAttendance(): void {
  if (registered || process.env.VITEST) return
  registered = true
  import('./baileys.service')
    .then((baileys) => baileys.onIncomingMessage(async (tenantId, phone, info) => {
      if (tenantId !== AI_WA_KEY) return
      await handleIncoming(phone, info?.text ?? null, info?.pushName ?? null)
    }))
    .catch((err) => console.error('[IA] Atendimento indisponível:', err))
}

// ── WhatsApp da IA (QR) ──────────────────────────────────────────────────────

export async function whatsappInfo() {
  const baileys = await import('./baileys.service')
  return baileys.getInfo(AI_WA_KEY)
}
export async function connectWhatsApp() {
  const baileys = await import('./baileys.service')
  await baileys.connect(AI_WA_KEY)
  return baileys.getInfo(AI_WA_KEY)
}
export async function disconnectWhatsApp() {
  const baileys = await import('./baileys.service')
  await baileys.disconnect(AI_WA_KEY)
}

// ── Assumir / passar adiante ─────────────────────────────────────────────────

/** O vendedor assume o lead: a IA para de responder, o lead vai para a etapa do vendedor e ele vira o responsável. */
export async function assumeLead(leadId: string, user: { id: string; name: string }) {
  const cfg = await getConfig()
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, include: { stage: true } })
  if (!lead) throw httpError(404, 'Lead não encontrado')
  const sellerStageId = cfg.sellerStageId ?? (await ensureStages()).sellerStageId
  const toStage = lead.aiActive ? sellerStageId : lead.stageId

  await prisma.$transaction(async (tx) => {
    await tx.lead.update({
      where: { id: leadId },
      data: {
        aiActive: false,
        aiAssumedAt: lead.aiActive ? new Date() : lead.aiAssumedAt,
        ownerId: user.id,
        ...(toStage !== lead.stageId ? { stageId: toStage, stageChangedAt: new Date() } : {}),
      },
    })
    if (lead.ownerId !== user.id) {
      await tx.task.updateMany({ where: { leadId, done: false, assigneeId: lead.ownerId }, data: { assigneeId: user.id } })
    }
    await tx.activity.create({
      data: { leadId, userId: user.id, type: 'NOTE', content: lead.aiActive ? `${user.name} assumiu o atendimento (a IA parou de responder)` : `${user.name} assumiu o lead` },
    })
  })
}

/** Passa o lead para o próximo vendedor da fila (ou um escolhido), p. ex. quando o designado está ocupado. */
export async function passLead(leadId: string, by: { id: string; name: string }, toUserId?: string | null) {
  const cfg = await getConfig()
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { id: true, ownerId: true } })
  if (!lead) throw httpError(404, 'Lead não encontrado')
  const target = toUserId ?? (await pickSeller((cfg.distribution as Distribution) === 'NONE' ? 'ROUND_ROBIN' : (cfg.distribution as Distribution), { exclude: lead.ownerId }))
  if (!target) throw httpError(409, 'Não há outro vendedor ativo para receber o lead')
  const users = await prisma.user.findMany({ where: { id: { in: [target, ...(lead.ownerId ? [lead.ownerId] : [])] } }, select: { id: true, name: true, active: true } })
  const dest = users.find((u) => u.id === target)
  if (!dest?.active) throw httpError(400, 'Responsável não encontrado ou inativo')
  const from = users.find((u) => u.id === lead.ownerId)

  await prisma.$transaction(async (tx) => {
    await tx.lead.update({ where: { id: leadId }, data: { ownerId: target } })
    await tx.task.updateMany({ where: { leadId, done: false, assigneeId: lead.ownerId }, data: { assigneeId: target } })
    await tx.activity.create({
      data: { leadId, userId: by.id, type: 'OWNER_CHANGE', content: `Responsável: ${from?.name ?? 'Sem responsável'} → ${dest.name}` },
    })
  })
  return dest
}

// ── Pedido de avaliação (Google Meu Negócio) ─────────────────────────────────

/** Envia o link de avaliação pelo WhatsApp da loja. `force` reenvia mesmo que já tenha sido enviado. */
export async function sendReviewRequest(leadId: string, opts: { force?: boolean; byUserId?: string } = {}): Promise<{ ok: boolean; error?: string }> {
  const cfg = await getConfig()
  if (!cfg.reviewLink) return { ok: false, error: 'Configure o link de avaliação em Atendimento IA' }
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { id: true, phone: true, reviewRequestedAt: true } })
  if (!lead) return { ok: false, error: 'Lead não encontrado' }
  if (!lead.phone) return { ok: false, error: 'O lead não tem telefone' }
  if (lead.reviewRequestedAt && !opts.force) return { ok: false, error: 'Pedido de avaliação já enviado' }

  const template = cfg.reviewMessage?.trim() || DEFAULT_REVIEW_MESSAGE
  const message = template.includes('{link}') ? template.replaceAll('{link}', cfg.reviewLink) : `${template} ${cfg.reviewLink}`
  const baileys = await import('./baileys.service')
  const sent = await baileys.sendMessage(AI_WA_KEY, lead.phone, message)
  if (!sent.ok) return sent
  await prisma.$transaction([
    prisma.lead.update({ where: { id: leadId }, data: { reviewRequestedAt: new Date() } }),
    prisma.activity.create({ data: { leadId, userId: opts.byUserId ?? null, type: 'NOTE', content: 'Pedido de avaliação (Google Meu Negócio) enviado pelo WhatsApp' } }),
  ])
  return { ok: true }
}

/** Chamado quando um lead é ganho: envia a avaliação sozinho se a loja ligou o envio automático. Nunca lança. */
export async function maybeSendReviewOnWin(leadId: string): Promise<void> {
  try {
    const cfg = await getConfig()
    if (!cfg.reviewAutoSend || !cfg.reviewLink) return
    await sendReviewRequest(leadId)
  } catch (err) {
    console.error('[IA] Falha ao enviar pedido de avaliação:', err)
  }
}
