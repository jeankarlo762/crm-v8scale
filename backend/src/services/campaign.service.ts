import { eligibleForNoWebsiteCampaign } from './lead-score.service'
import { noWebsiteEligibility } from './no-website-eligibility.service'
import { prisma } from '../config/database'
import { CreateCampaignInput, UpdateCampaignInput } from '../schemas/campaign.schema'
import { compareLeads } from './lead.service'
import { renderCampaignMessage } from '../utils/campaign-variables'
import { startReplyTracking } from './campaign-replies.service'

// Sessão de WhatsApp própria da campanha (mesma conexão Baileys/não-oficial
// do resto do sistema — ver baileys.service.ts — mas isolada num "tenant"
// sintético, já que quem opera isso é o Super Admin, sem tenantId). Import
// sempre dinâmico: o módulo depende de um binário nativo que pode falhar em
// algumas plataformas (mesmo motivo de whatsapp.service.ts).
const CAMPAIGN_WA_KEY = 'campaign-broadcast'

// Cadência: cada mensagem enviada por uma campanha empurra o lead pro próximo status.
const NEXT_CONTATO: Record<string, string> = {
  nao_contatado: 'contato_1',
  contato_1: 'contato_2',
  contato_2: 'contato_3',
  contato_3: 'sem_retorno',
}

function notFound(message: string) {
  return Object.assign(new Error(message), { statusCode: 404 })
}

function conflict(message: string) {
  return Object.assign(new Error(message), { statusCode: 409 })
}

// ─── Conexão WhatsApp da campanha ───────────────────────────────────────────

export async function getWhatsAppStatus() {
  const baileys = await import('./baileys.service')
  return baileys.getInfo(CAMPAIGN_WA_KEY)
}

export async function connectWhatsApp() {
  const baileys = await import('./baileys.service')
  await baileys.connect(CAMPAIGN_WA_KEY)
  return baileys.getInfo(CAMPAIGN_WA_KEY)
}

export async function disconnectWhatsApp() {
  const baileys = await import('./baileys.service')
  await baileys.disconnect(CAMPAIGN_WA_KEY)
}

// ─── Campanhas ───────────────────────────────────────────────────────────────

type RecipientCounts = { PENDING: number; SENT: number; FAILED: number; SKIPPED: number; total: number }

async function countsByCampaign(campaignIds: string[]): Promise<Record<string, RecipientCounts>> {
  if (campaignIds.length === 0) return {}
  const rows = await prisma.campaignRecipient.groupBy({
    by: ['campaignId', 'status'],
    where: { campaignId: { in: campaignIds } },
    _count: { _all: true },
  })
  const result: Record<string, RecipientCounts> = {}
  for (const id of campaignIds) result[id] = { PENDING: 0, SENT: 0, FAILED: 0, SKIPPED: 0, total: 0 }
  for (const row of rows) {
    const bucket = result[row.campaignId]
    const status = row.status as 'PENDING' | 'SENT' | 'FAILED' | 'SKIPPED'
    bucket[status] = row._count._all
    bucket.total += row._count._all
  }
  return result
}

const responsavelSelect = { responsavel: { select: { id: true, name: true } } }

export async function listCampaigns() {
  const campaigns = await prisma.campaign.findMany({ orderBy: { createdAt: 'desc' }, include: responsavelSelect })
  const counts = await countsByCampaign(campaigns.map((c) => c.id))
  return campaigns.map((c) => ({
    ...c,
    messages: JSON.parse(c.messages) as string[],
    counts: counts[c.id],
  }))
}

export async function getCampaign(id: string) {
  const campaign = await prisma.campaign.findUnique({
    where: { id },
    include: { recipients: { orderBy: { createdAt: 'asc' } }, ...responsavelSelect },
  })
  if (!campaign) throw notFound('Campanha não encontrada')
  const counts = (await countsByCampaign([id]))[id]
  return { ...campaign, messages: JSON.parse(campaign.messages) as string[], counts }
}

// Nome de exibição de um Prospect no CampaignRecipient — prioriza o contato
// da pessoa (mais natural numa mensagem 1:1) e cai pro nome da arena.
function displayName(p: { contactName: string | null; arenaName: string }): string {
  return p.contactName?.trim() || p.arenaName
}

const RECIPIENT_SELECT = { id: true, whatsapp: true, phoneE164: true, contactName: true, arenaName: true, leadScore: true, avaliacao: true, numAvaliacoes: true, websiteStatus: true, websiteConfidence: true, websiteOutcome: true, websiteValidUntil: true, classifierVersion: true, websiteCoverage: true, investigationState: true } as const

// Seleção individual (vinda da Prospecção): entram só os leads escolhidos que têm WhatsApp. Status/nicho/estado/cidade/limite não valem.
async function selectChosenRecipients(input: CreateCampaignInput) {
  const ids = [...new Set(input.prospectIds ?? [])]
  let found = await prisma.prospect.findMany({
    where: { id: { in: ids }, whatsapp: { not: null }, NOT: { whatsapp: '' } },
    select: RECIPIENT_SELECT,
  })
  if (input.publico === 'sem_site') found = found.filter((l) => eligibleForNoWebsiteCampaign(l))
  if (found.length === 0) {
    throw Object.assign(new Error(`Nenhum dos ${ids.length} lead(s) selecionado(s) pode receber a campanha (sem WhatsApp${input.publico === 'sem_site' ? ' ou sem decisão de "sem site" confirmada' : ''})`), { statusCode: 400 })
  }
  // Mantém a ordem em que o usuário selecionou.
  const order = new Map(ids.map((id, i) => [id, i]))
  found.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
  return { nicho: null, prospects: found }
}

// Resolve o nicho e os leads que entram na campanha para um alvo (status/nicho/estado/cidade/limite).
async function selectRecipients(input: CreateCampaignInput) {
  if (input.prospectIds?.length) return selectChosenRecipients(input)
  const nicho = input.nichoId
    ? await prisma.nicho.findUnique({ where: { id: input.nichoId }, select: { id: true, nome: true } })
    : null
  if (input.nichoId && !nicho) throw notFound('Nicho não encontrado')

  let found = await prisma.prospect.findMany({
    where: {
      status: input.targetStatus,
      whatsapp: { not: null },
      NOT: { whatsapp: '' }, // lead sem telefone (ex.: só descoberto, aguardando o Place Details) nunca entra em campanha de WhatsApp
      ...(nicho ? { nichoId: nicho.id } : {}),
      ...(input.estado ? { state: input.estado } : {}),
      ...(input.cidade ? { city: input.cidade } : {}),
    },
    select: RECIPIENT_SELECT,
  })
  if (input.publico === 'sem_site') found = found.filter((l) => eligibleForNoWebsiteCampaign(l))
  if (found.length === 0) {
    const escopo = (nicho ? ` no nicho "${nicho.nome}"` : '') + (input.cidade ? ` em ${input.cidade}` : '') + (input.estado ? ` (${input.estado})` : '')
    throw Object.assign(new Error(`Nenhum lead com o status "${input.targetStatus}"${escopo}${input.publico === 'sem_site' ? ' e decisão de "sem site" confirmada' : ''} no momento`), { statusCode: 400 })
  }

  // Com limite, leva os primeiros N na ordem da tabela de Prospecção (melhores primeiro).
  const prospects = input.limite > 0 ? found.sort(compareLeads).slice(0, input.limite) : found
  return { nicho, prospects }
}

function toRecipientRow(p: { id: string; whatsapp: string | null; phoneE164: string | null; contactName: string | null; arenaName: string }) {
  return {
    prospectId: p.id,
    name: displayName(p),
    phone: p.phoneE164 ?? (p.whatsapp as string), // E.164 quando disponível
  }
}

export async function createCampaign(input: CreateCampaignInput) {
  const { nicho, prospects } = await selectRecipients(input)

  const campaign = await prisma.campaign.create({
    data: {
      name: input.name,
      responsavelId: input.responsavelId,
      messages: JSON.stringify(input.messages),
      targetStatus: input.targetStatus,
      selecionados: !!input.prospectIds?.length,
      nichoId: nicho?.id ?? null,
      nichoNome: nicho?.nome ?? null,
      estado: input.prospectIds?.length ? null : input.estado ?? null,
      cidade: input.prospectIds?.length ? null : input.cidade ?? null,
      limite: !input.prospectIds?.length && input.limite > 0 ? input.limite : null,
      publico: input.publico,
      // Delay único: as colunas min/max continuam no banco (campanhas antigas usam
      // intervalo aleatório), mas as novas gravam o mesmo valor nas duas.
      delayMinSec: input.delaySec,
      delayMaxSec: input.delaySec,
      recipients: {
        create: prospects.map(toRecipientRow),
      },
    },
    include: { recipients: true },
  })
  return { ...campaign, messages: input.messages }
}

// Edita uma campanha parada (rascunho ou pausada). Nome, mensagens e delay sempre
// podem mudar. O alvo (status/nicho/estado/cidade/limite) só muda enquanto nenhum
// envio foi processado — aí a lista de destinatários é refeita; depois do primeiro
// envio ela fica congelada e o alvo enviado é ignorado.
export async function updateCampaign(id: string, input: UpdateCampaignInput) {
  const campaign = await prisma.campaign.findUnique({ where: { id } })
  if (!campaign) throw notFound('Campanha não encontrada')
  if (campaign.status === 'RUNNING') throw conflict('Pause a campanha antes de editar')
  if (campaign.status === 'DONE') throw conflict('Campanha concluída não pode ser editada')

  const processed = await prisma.campaignRecipient.count({ where: { campaignId: id, status: { not: 'PENDING' } } })

  const common = {
    name: input.name,
    responsavelId: input.responsavelId,
    messages: JSON.stringify(input.messages),
    // Delay único: grava o mesmo valor nas duas colunas (como na criação).
    delayMinSec: input.delaySec,
    delayMaxSec: input.delaySec,
  }

  // Campanha de seleção individual editada sem nova seleção: a lista de destinatários continua a mesma.
  if (processed > 0 || (campaign.selecionados && !input.prospectIds?.length)) {
    await prisma.campaign.update({ where: { id }, data: common })
  } else {
    const { nicho, prospects } = await selectRecipients(input)
    await prisma.$transaction([
      prisma.campaignRecipient.deleteMany({ where: { campaignId: id } }),
      prisma.campaign.update({
        where: { id },
        data: {
          ...common,
          targetStatus: input.targetStatus,
          selecionados: !!input.prospectIds?.length,
          nichoId: nicho?.id ?? null,
          nichoNome: nicho?.nome ?? null,
          estado: input.prospectIds?.length ? null : input.estado ?? null,
          cidade: input.prospectIds?.length ? null : input.cidade ?? null,
          limite: !input.prospectIds?.length && input.limite > 0 ? input.limite : null,
          publico: input.publico,
          recipients: { create: prospects.map(toRecipientRow) },
        },
      }),
    ])
  }
  return getCampaign(id)
}

export async function deleteCampaign(id: string) {
  const campaign = await prisma.campaign.findUnique({ where: { id } })
  if (!campaign) throw notFound('Campanha não encontrada')
  if (campaign.status === 'RUNNING') {
    throw conflict('Pause a campanha antes de excluir')
  }
  await prisma.campaign.delete({ where: { id } })
}

export async function startCampaign(id: string) {
  const campaign = await prisma.campaign.findUnique({ where: { id } })
  if (!campaign) throw notFound('Campanha não encontrada')
  if (campaign.status === 'RUNNING') throw conflict('Campanha já está em andamento')
  if (campaign.status === 'DONE') throw conflict('Campanha já foi concluída')
  if (campaign.publico === LEGACY_AUDIENCE) throw conflict('Campanha anterior ao controle de público: revise o público (todos ou só sem site) antes de iniciar')

  const otherRunning = await prisma.campaign.findFirst({ where: { status: 'RUNNING', id: { not: id } } })
  if (otherRunning) throw conflict(`Outra campanha ("${otherRunning.name}") já está em andamento — pause-a primeiro`)

  const wa = await getWhatsAppStatus()
  if (wa.status !== 'connected') throw conflict('Conecte o WhatsApp da campanha antes de iniciar')

  const updated = await prisma.campaign.update({ where: { id }, data: { status: 'RUNNING' } })
  dispatchLoop(id).catch((err) => console.error(`[Campaign] Erro no loop de disparo (campaign=${id}):`, err))
  return updated
}

// Campanha criada antes de o público ser gravado: a intenção original é desconhecida, então o envio fica bloqueado até alguém
// decidir explicitamente. A revisão NÃO inicia a campanha (ela continua PAUSED/DRAFT).
export const LEGACY_AUDIENCE = 'legacy_unverified'
export async function reviewCampaignAudience(id: string, publico: 'todos' | 'sem_site') {
  const campaign = await prisma.campaign.findUnique({ where: { id } })
  if (!campaign) throw notFound('Campanha não encontrada')
  if (campaign.publico !== LEGACY_AUDIENCE) throw conflict('O público desta campanha já foi definido')
  return prisma.campaign.update({ where: { id }, data: { publico, ...(campaign.status === 'RUNNING' ? { status: 'PAUSED' } : {}) } })
}

export async function pauseCampaign(id: string) {
  const campaign = await prisma.campaign.findUnique({ where: { id } })
  if (!campaign) throw notFound('Campanha não encontrada')
  if (campaign.status !== 'RUNNING') throw conflict('Campanha não está em andamento')
  return prisma.campaign.update({ where: { id }, data: { status: 'PAUSED' } })
}

// Loop de disparo: um destinatário PENDING por vez, com um delay aleatório
// (entre delayMinSec e delayMaxSec) entre cada envio — dá tempo humano entre
// mensagens em vez de um disparo em rajada (mais parecido com uso manual do
// WhatsApp, e evita derrubar a conexão). Reconsulta o status da campanha no
// banco a cada volta, então uma pausa pedida por outra request para o loop
// dentro de, no máximo, um ciclo de delay.
// WhatsApp caiu no meio da campanha (ou ainda está reconectando após um reinício): espera um pouco e, se não voltar,
// pausa a campanha SEM consumir a fila. Antes, cada destinatário era marcado FAILED e nunca mais reenviado.
const WA_WAIT_MS = 60_000
const WA_POLL_MS = 2_000
async function whatsappReady(baileys: typeof import('./baileys.service')): Promise<boolean> {
  const deadline = Date.now() + WA_WAIT_MS
  for (;;) {
    if (baileys.getInfo(CAMPAIGN_WA_KEY).status === 'connected') return true
    if (Date.now() >= deadline) return false
    await new Promise((resolve) => setTimeout(resolve, WA_POLL_MS))
  }
}
async function pauseForDisconnectedWhatsApp(campaignId: string): Promise<void> {
  console.warn(`[Campaign] WhatsApp desconectado: campanha ${campaignId} pausada (os destinatários pendentes foram preservados; reconecte e retome)`)
  await prisma.campaign.updateMany({ where: { id: campaignId, status: 'RUNNING' }, data: { status: 'PAUSED' } })
}

async function dispatchLoop(campaignId: string): Promise<void> {
  for (;;) {
    const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } })
    if (!campaign || campaign.status !== 'RUNNING') return
    if (campaign.publico === LEGACY_AUDIENCE) { // nunca envia com público desconhecido (inclusive no retomar do boot)
      await prisma.campaign.update({ where: { id: campaignId }, data: { status: 'PAUSED' } })
      return
    }

    const recipient = await prisma.campaignRecipient.findFirst({
      where: { campaignId, status: 'PENDING' },
      orderBy: { createdAt: 'asc' },
    })
    if (!recipient) {
      await prisma.campaign.update({ where: { id: campaignId }, data: { status: 'DONE' } })
      return
    }

    // Dados atuais do lead: alimentam as variáveis da mensagem ({{nome}}, {{cidade}}...) e a checagem "só sem site".
    const lead = recipient.prospectId
      ? await prisma.prospect.findUnique({ where: { id: recipient.prospectId }, select: { arenaName: true, contactName: true, city: true, state: true, status: true, websiteStatus: true, websiteConfidence: true, websiteOutcome: true, websiteValidUntil: true, classifierVersion: true, websiteCoverage: true, investigationState: true } })
      : null

    // Campanha "só sem site": a classificação pode ter perdido a validade DEPOIS da inclusão (evidência vencida, candidato novo,
    // reinvestigação em andamento). Reavalia no momento do envio; quem perdeu a elegibilidade é ignorado COM motivo registrado,
    // sem apagar o destinatário (histórico da campanha preservado).
    if (campaign.publico === 'sem_site') {
      const verdict = lead ? noWebsiteEligibility(lead) : { eligible: false, reasons: ['LEAD_REMOVED'] as string[] }
      if (!verdict.eligible) {
        await prisma.campaignRecipient.update({ where: { id: recipient.id }, data: { status: 'SKIPPED', skipReason: `ELEGIBILIDADE_PERDIDA: ${verdict.reasons.join(',')}`.slice(0, 300) } })
        continue
      }
    }

    const messages: string[] = JSON.parse(campaign.messages)
    const template = messages[Math.floor(Math.random() * messages.length)]
    const message = renderCampaignMessage(template, {
      nome: lead?.arenaName ?? recipient.name,
      contato: lead?.contactName,
      cidade: lead?.city,
      estado: lead?.state,
    })

    const baileys = await import('./baileys.service')
    if (!(await whatsappReady(baileys))) { await pauseForDisconnectedWhatsApp(campaignId); return }
    const result = await baileys.sendMessage(CAMPAIGN_WA_KEY, recipient.phone, message)
    // Caiu entre a checagem e o envio: não é falha do destinatário. Mantém na fila e pausa.
    if (!result.ok && result.error?.startsWith('WhatsApp não conectado')) { await pauseForDisconnectedWhatsApp(campaignId); return }

    await prisma.campaignRecipient.update({
      where: { id: recipient.id },
      data: {
        status: result.ok ? 'SENT' : 'FAILED',
        messageUsed: message,
        sentAt: result.ok ? new Date() : null,
        error: result.ok ? null : (result.error ?? 'Falha desconhecida'),
      },
    })

    // Só avança se o lead ainda está no status que a campanha mirava — não
    // sobrescreve uma mudança manual feita depois da criação da campanha.
    // Seleção individual: cada lead avança a partir do status em que ele está (os escolhidos podem estar em status diferentes).
    const fromStatus = campaign.selecionados ? lead?.status : campaign.targetStatus
    const next = fromStatus ? NEXT_CONTATO[fromStatus] : undefined
    if (result.ok && next && recipient.prospectId && fromStatus) {
      await prisma.prospect.updateMany({
        where: { id: recipient.prospectId, status: fromStatus },
        data: { status: next },
      })
    }
    // Alinhamento com o funil: quem foi contatado herda o responsável da campanha (sem sobrescrever
    // o que já estava definido à mão). É isso que o lead do funil recebe quando o prospect for convertido.
    if (result.ok && recipient.prospectId) {
      if (campaign.responsavelId) await prisma.prospect.updateMany({ where: { id: recipient.prospectId, responsavel: null }, data: { responsavel: campaign.responsavelId } })
    }

    const delaySec = campaign.delayMinSec + Math.random() * (campaign.delayMaxSec - campaign.delayMinSec)
    await new Promise((resolve) => setTimeout(resolve, delaySec * 1000))
  }
}

// Só para testes: roda o loop de disparo de uma campanha até acabar.
export const _dispatchLoopForTests = (campaignId: string): Promise<void> => dispatchLoop(campaignId)

// Retoma campanhas que ficaram RUNNING no banco mas cujo loop em memória se
// perdeu (reinício do servidor no meio do disparo) — mesmo padrão do
// auto-reconnect no fim de baileys.service.ts.
prisma.campaign
  .findMany({ where: { status: 'RUNNING' }, select: { id: true } })
  .then((rows) => {
    for (const row of rows) {
      dispatchLoop(row.id).catch((err) => console.error(`[Campaign] Erro ao retomar campanha ${row.id}:`, err))
    }
  })
  .catch(() => { /* tabela ainda não migrada — ignora */ })

// Registra quem responde às mensagens da campanha (alimenta o módulo de Relatórios).
startReplyTracking()
