import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  Browsers,
  initAuthCreds,
  BufferJSON,
  proto,
  type AuthenticationCreds,
  type AuthenticationState,
  type SignalDataTypeMap,
} from '@whiskeysockets/baileys'
import { Boom } from '@hapi/boom'
import QRCode from 'qrcode'
import pino from 'pino'
import { prisma } from '../config/database'
import { createSystemAlert } from './system-alert.service'

type Status = 'disconnected' | 'connecting' | 'connected'

interface TenantWaState {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sock: any
  qrDataUrl: string | null
  status: Status
  reconnectTimer: ReturnType<typeof setTimeout> | null
}

// Uma conexão de WhatsApp por tenant (arena), isoladas entre si.
const tenants = new Map<string, TenantWaState>()

// Mensagens RECEBIDAS (de contatos, 1:1): quem se interessa (ex.: relatório de respostas da campanha) se registra aqui.
// O handler recebe o telefone (dígitos) de quem escreveu; o texto e o nome do perfil vêm no 3º argumento e só
// interessam a quem atende a conversa (ex.: IA). O rastreio de campanha ignora o 3º argumento.
export interface IncomingInfo { text: string | null; pushName: string | null }
type IncomingHandler = (tenantId: string, phoneDigits: string, info: IncomingInfo) => void | Promise<void>
const incomingHandlers: IncomingHandler[] = []
export function onIncomingMessage(handler: IncomingHandler): void {
  incomingHandlers.push(handler)
}

// Telefone de quem escreveu. Contas novas chegam como @lid: o número vem em remoteJidAlt ou no mapa LID→número do Baileys.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function senderPhone(sock: any, key: { remoteJid?: string | null; remoteJidAlt?: string | null }): Promise<string | null> {
  const isPhoneJid = (j?: string | null) => !!j && j.endsWith('@s.whatsapp.net')
  if (isPhoneJid(key.remoteJidAlt)) return key.remoteJidAlt!.split('@')[0].split(':')[0]
  if (isPhoneJid(key.remoteJid)) return key.remoteJid!.split('@')[0].split(':')[0]
  if (key.remoteJid?.endsWith('@lid')) {
    try {
      const pn: string | null | undefined = await sock?.signalRepository?.lidMapping?.getPNForLID?.(key.remoteJid)
      if (pn) return pn.split('@')[0].split(':')[0]
    } catch { /* sem mapeamento: não dá para atribuir */ }
  }
  return null
}

// Texto de uma mensagem recebida (texto simples, resposta/encaminhada ou legenda de mídia); null para áudio, figurinha etc.
function messageText(message: unknown): string | null {
  const m = message as {
    conversation?: string
    extendedTextMessage?: { text?: string }
    imageMessage?: { caption?: string }
    videoMessage?: { caption?: string }
  } | null | undefined
  const text = m?.conversation || m?.extendedTextMessage?.text || m?.imageMessage?.caption || m?.videoMessage?.caption
  return text?.trim() || null
}

function getState(tenantId: string): TenantWaState {
  let s = tenants.get(tenantId)
  if (!s) {
    s = { sock: null, qrDataUrl: null, status: 'disconnected', reconnectTimer: null }
    tenants.set(tenantId, s)
  }
  return s
}

export function getInfo(tenantId: string) {
  const s = getState(tenantId)
  return { status: s.status, qr: s.qrDataUrl }
}

// ── Auth state persistido no PostgreSQL ──────────────────────────────
// Substitui o useMultiFileAuthState (que grava em disco) para que a sessão
// sobreviva a reinícios do servidor no Railway (filesystem efêmero).
// Cada tenant tem sua própria linha (tenantId + id) para isolar as sessões.
async function useDatabaseAuthState(tenantId: string): Promise<{
  state: AuthenticationState
  saveCreds: () => Promise<void>
}> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function readData(id: string): Promise<any | null> {
    const row = await prisma.whatsAppAuth.findUnique({ where: { tenantId_id: { tenantId, id } } })
    return row ? JSON.parse(row.value, BufferJSON.reviver) : null
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function writeData(id: string, value: any): Promise<void> {
    const str = JSON.stringify(value, BufferJSON.replacer)
    await prisma.whatsAppAuth.upsert({
      where: { tenantId_id: { tenantId, id } },
      create: { tenantId, id, value: str },
      update: { value: str },
    })
  }
  async function removeData(id: string): Promise<void> {
    await prisma.whatsAppAuth.deleteMany({ where: { tenantId, id } })
  }

  const creds: AuthenticationCreds = (await readData('creds')) || initAuthCreds()

  return {
    state: {
      creds,
      keys: {
        get: async <T extends keyof SignalDataTypeMap>(type: T, ids: string[]) => {
          const data: { [id: string]: SignalDataTypeMap[T] } = {}
          await Promise.all(
            ids.map(async (id) => {
              let value = await readData(`${type}-${id}`)
              if (type === 'app-state-sync-key' && value) {
                value = proto.Message.AppStateSyncKeyData.fromObject(value)
              }
              data[id] = value
            }),
          )
          return data
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        set: async (data: any) => {
          const tasks: Promise<void>[] = []
          for (const category in data) {
            for (const id in data[category]) {
              const value = data[category][id]
              const key = `${category}-${id}`
              tasks.push(value ? writeData(key, value) : removeData(key))
            }
          }
          await Promise.all(tasks)
        },
      },
    },
    saveCreds: async () => {
      await writeData('creds', creds)
    },
  }
}

export async function connect(tenantId: string): Promise<void> {
  const s = getState(tenantId)
  if (s.status === 'connected' || s.status === 'connecting') return
  if (s.reconnectTimer) {
    clearTimeout(s.reconnectTimer)
    s.reconnectTimer = null
  }
  s.status = 'connecting'
  s.qrDataUrl = null

  const { state, saveCreds } = await useDatabaseAuthState(tenantId)
  const { version } = await fetchLatestBaileysVersion()

  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
    browser: Browsers.ubuntu('V8 Scale'),
    connectTimeoutMs: 30_000,
  })
  s.sock = sock

  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('messages.upsert', async (ev: { type?: string; messages?: Array<{ key: { fromMe?: boolean | null; remoteJid?: string | null; remoteJidAlt?: string | null }; message?: unknown; pushName?: string | null }> }) => {
    if (ev.type !== 'notify' || incomingHandlers.length === 0) return
    for (const m of ev.messages ?? []) {
      // Só conversa 1:1 recebida (ignora o que a própria conta enviou, grupos, status e mensagens de protocolo).
      if (m.key.fromMe || !m.message || !m.key.remoteJid || m.key.remoteJid.endsWith('@g.us') || m.key.remoteJid === 'status@broadcast') continue
      const phone = await senderPhone(sock, m.key)
      if (!phone) continue
      const info: IncomingInfo = { text: messageText(m.message), pushName: m.pushName?.trim() || null }
      for (const h of incomingHandlers) {
        try { await h(tenantId, phone, info) } catch (err) { console.error('[WhatsApp] Erro ao processar mensagem recebida:', err) }
      }
    }
  })

  sock.ev.on('connection.update', async (update: { connection?: string; lastDisconnect?: { error: unknown }; qr?: string }) => {
    const { connection, lastDisconnect, qr } = update

    if (qr) {
      s.qrDataUrl = await QRCode.toDataURL(qr)
    }

    if (connection === 'open') {
      s.qrDataUrl = null
      s.status = 'connected'
      console.log(`[WhatsApp] Conectado! (tenant=${tenantId})`)
    }

    if (connection === 'close') {
      const code = (lastDisconnect?.error as Boom)?.output?.statusCode
      const loggedOut = code === DisconnectReason.loggedOut
      s.status = 'disconnected'
      s.qrDataUrl = null
      s.sock = null
      console.log(`[WhatsApp] Desconectado (tenant=${tenantId}, código ${code})`)

      if (loggedOut) {
        // Sessão invalidada pelo WhatsApp — limpa credenciais para novo QR
        await prisma.whatsAppAuth.deleteMany({ where: { tenantId } }).catch(() => {})
      } else {
        console.log(`[WhatsApp] Reconectando em 5s... (tenant=${tenantId})`)
        s.reconnectTimer = setTimeout(() => connect(tenantId), 5000)
      }
    }
  })
}

export async function disconnect(tenantId: string): Promise<void> {
  const s = getState(tenantId)
  if (s.reconnectTimer) {
    clearTimeout(s.reconnectTimer)
    s.reconnectTimer = null
  }
  try { await s.sock?.logout() } catch { /* ignore */ }
  s.sock = null
  s.status = 'disconnected'
  s.qrDataUrl = null
  await prisma.whatsAppAuth.deleteMany({ where: { tenantId } }).catch(() => {})
}

// Gera as variações possíveis de um telefone brasileiro (com e sem o 9º dígito).
// No Brasil, alguns números estão registrados no WhatsApp COM o 9 e outros SEM,
// então precisamos testar as duas formas e usar a que realmente existe.
function brazilCandidates(raw: string): string[] {
  const digits = raw.replace(/\D/g, '')
  // E.164 de outro país (ex.: +54 9 ...): usa como veio, sem variações brasileiras.
  if (raw.trim().startsWith('+') && !digits.startsWith('55')) return [digits]
  const base = digits.startsWith('55') ? digits : `55${digits}`
  const set = new Set<string>([base])
  // 55 + DDD(2) + 9 + 8 = 13 dígitos → também tenta SEM o 9
  if (base.length === 13 && base[4] === '9') set.add(base.slice(0, 4) + base.slice(5))
  // 55 + DDD(2) + 8 = 12 dígitos → também tenta COM o 9
  if (base.length === 12) set.add(`${base.slice(0, 4)}9${base.slice(4)}`)
  return [...set]
}

// Descobre o JID real no WhatsApp, tratando o 9º dígito automaticamente.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function resolveJid(sock: any, raw: string): Promise<string | null> {
  const candidates = brazilCandidates(raw)
  for (const c of candidates) {
    try {
      const res = await sock.onWhatsApp(c)
      if (res && res[0]?.exists && res[0]?.jid) return res[0].jid
    } catch (err) {
      console.error('[WhatsApp] Falha ao verificar número:', err)
    }
  }
  return null
}

// Retorna { ok, error } além de alertar/logar — quem só dispara e esquece
// (a maioria dos call sites) pode ignorar o retorno normalmente (funções
// tipadas Promise<void> aceitam retornar isso sem erro de tipo); quem
// precisa saber se o envio realmente saiu (ex.: campaign.service.ts, que
// marca cada destinatário como enviado/falhou) usa o retorno.
export async function sendMessage(tenantId: string, to: string, text: string): Promise<{ ok: boolean; error?: string }> {
  const s = getState(tenantId)
  if (!s.sock || s.status !== 'connected') {
    const error = `WhatsApp não conectado (status=${s.status})`
    console.warn(`[WhatsApp] Mensagem não enviada: WhatsApp não conectado (tenant=${tenantId}, status=${s.status})`)
    await createSystemAlert({
      tenantId,
      channel: 'WHATSAPP',
      context: 'envio-mensagem',
      recipient: to,
      error,
    })
    return { ok: false, error }
  }
  try {
    const jid = await resolveJid(s.sock, to)
    if (!jid) {
      const error = 'Número não encontrado no WhatsApp'
      console.warn(`[WhatsApp] Número ${to} não encontrado no WhatsApp — mensagem não enviada (tenant=${tenantId})`)
      return { ok: false, error }
    }
    await s.sock.sendMessage(jid, { text })
    console.log(`[WhatsApp] Mensagem enviada para ${jid} (tenant=${tenantId})`)
    return { ok: true }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    console.error(`[WhatsApp] Erro ao enviar mensagem para ${to} (tenant=${tenantId}):`, err)
    await createSystemAlert({
      tenantId,
      channel: 'WHATSAPP',
      context: 'envio-mensagem',
      recipient: to,
      error,
    })
    return { ok: false, error }
  }
}

// Auto-conecta na inicialização os tenants que já têm sessão salva no banco
prisma.whatsAppAuth
  .findMany({ where: { id: 'creds' }, select: { tenantId: true }, distinct: ['tenantId'] })
  .then((rows) => {
    for (const row of rows) {
      connect(row.tenantId).catch((err: unknown) => console.error(`[WhatsApp] Erro na inicialização (tenant=${row.tenantId}):`, err))
    }
  })
  .catch(() => { /* tabela ainda não migrada — ignora */ })
