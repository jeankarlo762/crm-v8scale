import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import {
  Megaphone, Plus, Play, Pause, Trash2, X, CheckCircle2, Loader2, XCircle,
  QrCode, Clock, Users, Send, Copy, Pencil, Sparkles,
} from 'lucide-react'
import { PageHeader } from '../../components/layout/AppLayout'
import { Spinner } from '../../components/ui/Spinner'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Select } from '../../components/ui/Select'
import { Modal } from '../../components/ui/Modal'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { cn } from '../../utils/cn'
import { errMsg } from '../../utils/apiError'
import * as campaignApi from '../../api/campaign.api'
import * as leadApi from '../../api/lead.api'
import type { Campaign, CampaignDetail, CampaignStatus, RecipientStatus, WhatsAppInfo } from '../../api/campaign.api'
import type { Nicho, StatusContato } from '../../api/lead.api'
import { useResponsaveis } from '../Prospeccao/parts/shared'
import { OBJECTIVE_OPTIONS, VARIABLE_OPTIONS, generateVariations, previewMessage, unknownVariables, type CampaignObjective } from './messageTemplates'

const PROSPECT_STATUS_LABEL: Record<StatusContato, string> = {
  nao_contatado: 'Não contatado', contato_1: 'Contato 1', contato_2: 'Contato 2', contato_3: 'Contato 3', sem_retorno: 'Sem retorno',
  negociando: 'Negociando', fechado: 'Fechado', recusado: 'Recusado',
}
const PROSPECT_STATUS_OPTIONS: StatusContato[] = ['nao_contatado', 'contato_1', 'contato_2', 'contato_3', 'sem_retorno', 'negociando', 'fechado', 'recusado']

const CAMPAIGN_STATUS_LABEL: Record<CampaignStatus, string> = {
  DRAFT: 'Rascunho', RUNNING: 'Em andamento', PAUSED: 'Pausada', DONE: 'Concluída',
}
const CAMPAIGN_STATUS_COLOR: Record<CampaignStatus, string> = {
  DRAFT: 'bg-surface-hover text-fg-muted',
  RUNNING: 'bg-tone-green-bg text-tone-green-fg',
  PAUSED: 'bg-tone-amber-bg text-tone-amber-fg',
  DONE: 'bg-tone-blue-bg text-tone-blue-fg',
}
const RECIPIENT_STATUS_LABEL: Record<RecipientStatus, string> = {
  PENDING: 'Pendente', SENT: 'Enviada', FAILED: 'Falhou', SKIPPED: 'Ignorada',
}
const RECIPIENT_STATUS_COLOR: Record<RecipientStatus, string> = {
  PENDING: 'bg-surface-hover text-fg-muted',
  SENT: 'bg-tone-green-bg text-tone-green-fg',
  FAILED: 'bg-tone-red-bg text-tone-red-fg',
  SKIPPED: 'bg-surface-hover text-fg-muted',
}

const WA_STATUS_CONFIG = {
  connected: { label: 'Conectado', color: 'bg-tone-green-bg text-tone-green-fg', icon: CheckCircle2 },
  connecting: { label: 'Aguardando QR', color: 'bg-tone-orange-bg text-orange-700 dark:bg-orange-900/30 dark:text-orange-400', icon: Loader2 },
  disconnected: { label: 'Desconectado', color: 'bg-surface-hover text-fg-muted', icon: XCircle },
}

// ── Conexão WhatsApp da campanha (QR, não-oficial) ──────────────────────────
function WhatsAppConnectionCard() {
  const [info, setInfo] = useState<WhatsAppInfo>({ status: 'disconnected', qr: null })
  const [busy, setBusy] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  async function refresh() {
    try { setInfo(await campaignApi.getWhatsAppStatus()) } catch { /* ignore */ }
  }
  function startPolling() { stopPolling(); pollRef.current = setInterval(refresh, 3000) }
  function stopPolling() { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null } }

  useEffect(() => {
    refresh()
    return () => stopPolling()
  }, [])

  useEffect(() => {
    if (info.status === 'connecting') startPolling()
    else stopPolling()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [info.status])

  async function handleConnect() {
    setBusy(true)
    try {
      await campaignApi.connectWhatsApp()
      await refresh()
      toast.success('Escaneie o QR Code com o WhatsApp que vai disparar as campanhas')
    } catch {
      toast.error('Erro ao iniciar conexão')
    } finally {
      setBusy(false)
    }
  }

  async function handleDisconnect() {
    setBusy(true)
    try {
      await campaignApi.disconnectWhatsApp()
      setInfo({ status: 'disconnected', qr: null })
      toast.success('WhatsApp desconectado')
    } catch {
      toast.error('Erro ao desconectar')
    } finally {
      setBusy(false)
    }
  }

  const statusCfg = WA_STATUS_CONFIG[info.status]
  const StatusIcon = statusCfg.icon

  return (
    <div className="bg-surface rounded-xl border border-border p-5 flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-tone-green-solid/10 flex items-center justify-center shrink-0">
            <QrCode size={18} className="text-tone-green-fg" />
          </div>
          <div>
            <p className="text-sm font-semibold text-fg">WhatsApp da campanha</p>
            <p className="text-xs text-fg-muted">Conexão não-oficial (QR Code), separada do WhatsApp de cada arena</p>
          </div>
        </div>
        <span className={cn('inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full', statusCfg.color)}>
          <StatusIcon size={12} className={info.status === 'connecting' ? 'animate-spin' : ''} />
          {statusCfg.label}
        </span>
      </div>

      {info.status === 'connecting' && (
        <div className="flex flex-col items-center gap-2 py-2">
          {info.qr ? (
            <>
              <img src={info.qr} alt="QR Code WhatsApp" className="w-44 h-44 rounded-lg border border-border" />
              <p className="text-xs text-fg-muted">O QR Code expira em ~60s. Atualizando automaticamente...</p>
            </>
          ) : (
            <div className="flex items-center gap-2 py-6">
              <Spinner size="sm" />
              <span className="text-sm text-fg-muted">Gerando QR Code...</span>
            </div>
          )}
        </div>
      )}

      <div>
        {info.status === 'connected' ? (
          <Button variant="secondary" onClick={handleDisconnect} loading={busy}>Desconectar</Button>
        ) : (
          <Button onClick={handleConnect} loading={busy} disabled={info.status === 'connecting'}>
            {info.status === 'connecting' ? 'Aguardando QR Code...' : 'Conectar WhatsApp'}
          </Button>
        )}
      </div>
    </div>
  )
}

// Campanhas novas têm delay único (min = max); as antigas podem ter intervalo.
function delayLabel(c: { delayMinSec: number; delayMaxSec: number }): string {
  return c.delayMinSec === c.delayMaxSec ? `${c.delayMinSec}s` : `${c.delayMinSec}-${c.delayMaxSec}s`
}

// ── Formulário de nova campanha (ou cópia de uma existente via `duplicateFrom`) ──
interface CampaignPrefill { targetStatus?: StatusContato; nichoId?: string; estado?: string; cidade?: string; leadIds?: string[] }

function NewCampaignModal({
  open, duplicateFrom, editing, prefill, onClose, onCreated,
}: { open: boolean; duplicateFrom: Campaign | null; editing: Campaign | null; prefill?: CampaignPrefill | null; onClose: () => void; onCreated: () => void }) {
  // Depois do primeiro envio o alvo e os destinatários ficam congelados (só nome, mensagens e delay mudam).
  const targetLocked = !!editing && editing.counts.SENT + editing.counts.FAILED > 0
  const responsaveis = useResponsaveis()
  const [name, setName] = useState('')
  const [responsavelId, setResponsavelId] = useState('')
  const [targetStatus, setTargetStatus] = useState<StatusContato>('nao_contatado')
  const [nichoId, setNichoId] = useState('')
  const [nichos, setNichos] = useState<Nicho[]>([])
  const [estado, setEstado] = useState('')
  const [estados, setEstados] = useState<string[]>([])
  const [cidade, setCidade] = useState('')
  const [cidades, setCidades] = useState<string[]>([])
  const [messages, setMessages] = useState<string[]>([''])
  const [delaySec, setDelaySec] = useState('5')
  const [limite, setLimite] = useState('0')
  const [publico, setPublico] = useState<'todos' | 'sem_site'>('todos')
  const [saving, setSaving] = useState(false)
  // Seleção individual vinda da Prospecção. Em campanha já criada com seleção (editing.selecionados) a lista fica travada.
  const [leadIds, setLeadIds] = useState<string[]>([])
  const selectionLocked = !!editing?.selecionados && leadIds.length === 0
  const selectionMode = leadIds.length > 0 || selectionLocked
  // Gerador de variações + variáveis
  const [objective, setObjective] = useState<CampaignObjective>('site')
  const [detalhe, setDetalhe] = useState('')
  const [genOpen, setGenOpen] = useState(false)
  const messageRefs = useRef<(HTMLTextAreaElement | null)[]>([])
  const lastFocused = useRef(0)
  // Cidade da campanha copiada: só dá pra aplicar depois que a lista de cidades do nicho carrega.
  const pendingCidade = useRef<string | null>(null)
  const pendingEstado = useRef<string | null>(null)

  useEffect(() => {
    if (!open) return
    const source = editing ?? duplicateFrom
    if (source) {
      setName(editing ? source.name : `${source.name} (cópia)`)
      setResponsavelId(source.responsavelId ?? '')
      setTargetStatus(source.targetStatus)
      setNichoId(source.nichoId ?? '')
      setMessages(source.messages.length ? source.messages : [''])
      setDelaySec(String(source.delayMaxSec))
      setLimite(String(source.limite ?? 0))
      setPublico(source.publico === 'sem_site' ? 'sem_site' : 'todos')
      pendingCidade.current = source.cidade
      pendingEstado.current = source.estado
    } else {
      setName(''); setResponsavelId(''); setTargetStatus(prefill?.targetStatus ?? 'nao_contatado'); setNichoId(prefill?.nichoId ?? ''); setMessages(['']); setDelaySec('5'); setLimite('0'); setPublico('todos')
      pendingCidade.current = prefill?.cidade ?? null
      pendingEstado.current = prefill?.estado ?? null
    }
    setLeadIds(!editing && !duplicateFrom ? prefill?.leadIds ?? [] : [])
    setGenOpen(false); setDetalhe('')
    setEstado('')
    setCidade('')
  }, [open, duplicateFrom, editing, prefill])

  useEffect(() => {
    if (!open) return
    leadApi.listNichos().then(setNichos).catch(() => toast.error('Erro ao carregar os nichos'))
  }, [open])

  // Estados disponíveis dependem do nicho escolhido; trocar o nicho zera estado e cidade.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    setEstado('')
    leadApi.listEstados(nichoId || undefined)
      .then((list) => {
        if (cancelled) return
        setEstados(list)
        const wanted = pendingEstado.current
        pendingEstado.current = null
        if (wanted && list.includes(wanted)) setEstado(wanted)
      })
      .catch(() => { if (!cancelled) toast.error('Erro ao carregar os estados') })
    return () => { cancelled = true }
  }, [open, nichoId])

  // Cidades disponíveis dependem do nicho e do estado escolhidos; trocar qualquer um zera a cidade.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    setCidade('')
    leadApi.listCidades(nichoId || undefined, estado || undefined)
      .then((list) => {
        if (cancelled) return
        setCidades(list)
        const wanted = pendingCidade.current
        pendingCidade.current = null
        if (wanted && list.includes(wanted)) setCidade(wanted)
      })
      .catch(() => { if (!cancelled) toast.error('Erro ao carregar as cidades') })
    return () => { cancelled = true }
  }, [open, nichoId, estado])

  function updateMessage(i: number, value: string) {
    setMessages((prev) => prev.map((m, idx) => (idx === i ? value : m)))
  }
  function addMessage() {
    if (messages.length >= 20) return
    setMessages((prev) => [...prev, ''])
  }
  // Insere a variável na posição do cursor da variação em foco (ou no fim da última usada).
  function insertVariable(key: string) {
    const i = Math.min(lastFocused.current, messages.length - 1)
    const token = `{{${key}}}`
    const el = messageRefs.current[i]
    const current = messages[i] ?? ''
    const start = el?.selectionStart ?? current.length
    const end = el?.selectionEnd ?? current.length
    const next = `${current.slice(0, start)}${token}${current.slice(end)}`.slice(0, 1000)
    updateMessage(i, next)
    requestAnimationFrame(() => { el?.focus(); const pos = start + token.length; el?.setSelectionRange(pos, pos) })
  }
  function handleGenerate() {
    const generated = generateVariations(objective, detalhe)
    const hasContent = messages.some((m) => m.trim())
    setMessages(generated)
    setGenOpen(false)
    toast.success(hasContent ? '3 variações geradas no lugar das anteriores. Revise e ajuste como quiser.' : '3 variações geradas. Revise e ajuste como quiser.')
  }
  function removeMessage(i: number) {
    setMessages((prev) => (prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev))
  }

  async function handleSubmit() {
    const cleanMessages = messages.map((m) => m.trim()).filter(Boolean)
    if (!name.trim()) { toast.error('Nome da campanha obrigatório'); return }
    if (!responsavelId) { toast.error('Informe o responsável pela campanha'); return }
    if (cleanMessages.length === 0) { toast.error('Informe ao menos uma mensagem'); return }
    const badVar = cleanMessages.flatMap(unknownVariables)
    if (badVar.length) { toast.error(`Variável desconhecida: ${[...new Set(badVar)].map((v) => `{{${v}}}`).join(', ')}`); return }
    const delay = Number(delaySec) || 0
    if (delay < 1) { toast.error('Delay deve ser de ao menos 1 segundo'); return }
    const limiteNum = Number(limite)
    if (!Number.isInteger(limiteNum) || limiteNum < 0 || limiteNum > 5000) { toast.error('O limite deve ser um número de 0 a 5000'); return }

    setSaving(true)
    try {
      const payload = {
        name: name.trim(), responsavelId, messages: cleanMessages, targetStatus, nichoId: nichoId || null, estado: estado || null, cidade: cidade || null, limite: limiteNum, delaySec: delay, publico,
        ...(leadIds.length ? { prospectIds: leadIds } : {}),
      }
      if (editing) await campaignApi.updateCampaign(editing.id, payload)
      else await campaignApi.createCampaign(payload)
      toast.success(editing ? 'Campanha atualizada' : 'Campanha criada')
      onCreated()
      onClose()
    } catch (err) {
      toast.error(errMsg(err) ?? (editing ? 'Erro ao salvar campanha' : 'Erro ao criar campanha'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? 'Editar campanha' : duplicateFrom ? 'Duplicar campanha' : 'Nova campanha'}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button onClick={handleSubmit} loading={saving}>{editing ? 'Salvar alterações' : 'Criar campanha'}</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {targetLocked && (
          <p className="text-xs rounded-lg border border-border bg-surface-hover text-fg-muted px-3 py-2">
            Esta campanha já enviou mensagens: o alvo e os destinatários ficam travados. Você pode mudar nome, mensagens e delay.
          </p>
        )}
        {selectionMode && (
          <div className="flex items-start justify-between gap-3 rounded-lg border border-orange-300 bg-orange-50 dark:bg-orange-900/20 dark:border-orange-800 px-3 py-2">
            <p className="text-xs text-fg">
              {selectionLocked
                ? 'Esta campanha usa leads escolhidos individualmente na Prospecção. A lista de destinatários continua a mesma; você pode mudar nome, mensagens e delay.'
                : <><strong>{leadIds.length} lead(s) selecionado(s) individualmente</strong> na Prospecção. Só eles recebem a campanha (leads sem WhatsApp são ignorados). Status, nicho, estado, cidade e limite não se aplicam.</>}
            </p>
            {!selectionLocked && (
              <button type="button" onClick={() => setLeadIds([])} className="text-xs font-semibold text-orange-700 dark:text-orange-300 hover:underline shrink-0">Usar filtros</button>
            )}
          </div>
        )}
        <Input label="Nome da campanha" value={name} onChange={(e) => setName(e.target.value)} placeholder="ex: Reativação setembro" />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Select
            label="Responsável pela campanha *"
            value={responsavelId}
            onChange={(e) => setResponsavelId(e.target.value)}
            options={[{ value: '', label: 'Selecione o responsável' }, ...responsaveis.map((u) => ({ value: u.id, label: u.name }))]}
          />
          <p className="sm:col-span-2 text-xs text-fg-muted -mt-2">
            Quem for contatado herda a área e o responsável (se ainda não tiver). Ao chegar em "Negociando", o prospect vira lead do funil com esse vendedor e a área como segmento.
          </p>
          <Select
            label="Enviar para prospects com status"
            disabled={targetLocked || selectionMode}
            value={targetStatus}
            onChange={(e) => setTargetStatus(e.target.value as StatusContato)}
            options={PROSPECT_STATUS_OPTIONS.map((s) => ({ value: s, label: PROSPECT_STATUS_LABEL[s] }))}
          />
          <Select
            label="Nicho"
            disabled={targetLocked || selectionMode}
            value={nichoId}
            onChange={(e) => setNichoId(e.target.value)}
            options={[{ value: '', label: 'Todos os nichos' }, ...nichos.map((n) => ({ value: n.id, label: n.nome }))]}
          />
          <Select
            label="Estado"
            disabled={targetLocked || selectionMode}
            value={estado}
            onChange={(e) => setEstado(e.target.value)}
            options={[{ value: '', label: 'Todos os estados' }, ...estados.map((uf) => ({ value: uf, label: uf }))]}
          />
          <Select
            label="Cidade"
            disabled={targetLocked || selectionMode}
            value={cidade}
            onChange={(e) => setCidade(e.target.value)}
            options={[{ value: '', label: 'Todas as cidades' }, ...cidades.map((c) => ({ value: c, label: c }))]}
          />
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-fg">Mensagens (variações)</label>
            <span className="text-xs text-fg-muted">{messages.length}/20</span>
          </div>
          <p className="text-xs text-fg-muted">
            Cada destinatário recebe uma dessas mensagens, escolhida ao acaso — ex.: "Oi", "Opa", "Olá".
          </p>
          <div className="rounded-lg border border-border bg-surface-hover/50 p-3 flex flex-col gap-3">
            <button type="button" onClick={() => setGenOpen((o) => !o)} className="self-start inline-flex items-center gap-1.5 text-xs font-semibold text-orange-600 dark:text-orange-400 hover:text-orange-700">
              <Sparkles size={14} /> {genOpen ? 'Fechar gerador' : 'Criar 3 variações pela necessidade do cliente'}
            </button>
            {genOpen && (
              <div className="flex flex-col gap-3">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {OBJECTIVE_OPTIONS.map((o) => (
                    <button
                      key={o.value} type="button" onClick={() => setObjective(o.value)}
                      className={cn('text-left rounded-lg border px-3 py-2 transition-colors', objective === o.value ? 'border-orange-500 bg-orange-50 dark:bg-orange-900/20' : 'border-border bg-surface hover:bg-surface-hover')}
                    >
                      <span className="block text-sm font-semibold text-fg">{o.label}</span>
                      <span className="block text-xs text-fg-muted">{o.hint}</span>
                    </button>
                  ))}
                </div>
                <label className="flex flex-col gap-1 text-xs font-medium text-fg">Detalhe da necessidade (opcional)
                  <textarea
                    value={detalhe} onChange={(e) => setDetalhe(e.target.value)} rows={2} maxLength={200}
                    placeholder="ex.: Estamos com condição especial de lançamento este mês"
                    className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-fg focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-400"
                  />
                </label>
                <div className="flex items-center gap-2">
                  <Button onClick={handleGenerate}><Sparkles size={14} /> Gerar 3 variações</Button>
                  <span className="text-xs text-fg-muted">Substitui as variações atuais. Você pode editar depois.</span>
                </div>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-fg-muted">Variáveis (clique para inserir):</span>
              {VARIABLE_OPTIONS.map((v) => (
                <button key={v.key} type="button" title={`${v.label} — ex.: ${v.example}`} onClick={() => insertVariable(v.key)}
                  className="text-xs font-mono rounded-md border border-border bg-surface px-2 py-0.5 text-fg hover:bg-surface-hover">{`{{${v.key}}}`}</button>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-2">
            {messages.map((msg, i) => (
              <div key={i} className="flex flex-wrap items-start gap-2">
                <textarea
                  ref={(el) => { messageRefs.current[i] = el }}
                  onFocus={() => { lastFocused.current = i }}
                  value={msg}
                  onChange={(e) => updateMessage(i, e.target.value)}
                  placeholder={`Variação ${i + 1}`}
                  rows={2}
                  maxLength={1000}
                  className="flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-fg focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-400"
                />
                {msg.includes('{{') && (
                  <p className="basis-full text-xs text-fg-muted -mt-1 pl-1">
                    {unknownVariables(msg).length
                      ? <span className="text-tone-red-fg">Variável desconhecida: {unknownVariables(msg).map((v) => `{{${v}}}`).join(', ')}</span>
                      : <>Prévia: {previewMessage(msg)}</>}
                  </p>
                )}
                {messages.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeMessage(i)}
                    className="p-2 text-fg-muted hover:text-tone-red-solid transition-colors shrink-0"
                    title="Remover variação"
                  >
                    <X size={16} />
                  </button>
                )}
              </div>
            ))}
          </div>
          {messages.length < 20 && (
            <button
              type="button"
              onClick={addMessage}
              className="self-start inline-flex items-center gap-1 text-xs font-semibold text-orange-600 dark:text-orange-400 hover:text-orange-700 dark:hover:text-orange-300"
            >
              <Plus size={14} /> Adicionar variação
            </button>
          )}
        </div>

        <label className="flex flex-col gap-1 text-sm font-medium text-fg">Público
          <select value={publico} disabled={targetLocked || selectionLocked} onChange={(e) => setPublico(e.target.value as 'todos' | 'sem_site')} className="text-sm rounded-xl border border-border bg-surface text-fg px-3 py-2.5 outline-none focus:border-orange-400">
            <option value="todos">Todos os leads com esse status de contato</option>
            <option value="sem_site">Só quem não tem site (decisão confirmada)</option>
          </select>
        </label>
        <p className="text-xs text-fg-muted -mt-2">
          "Só quem não tem site" leva apenas leads com decisão de ausência de site e confiança mínima. A confirmar, conflito e sem decisão nunca entram sozinhos.
        </p>

        <Input
          label="Delay entre envios (segundos)"
          type="number" min={1} step={1}
          value={delaySec} onChange={(e) => setDelaySec(e.target.value)}
        />
        <p className="text-xs text-fg-muted -mt-2">
          Tempo de espera entre um envio e o próximo, pra não disparar tudo em rajada.
        </p>

        <Input
          label="Limite de envios (0 a 5000)"
          disabled={targetLocked || selectionMode}
          type="number" min={0} max={5000} step={1}
          value={limite} onChange={(e) => setLimite(e.target.value)}
        />
        <p className="text-xs text-fg-muted -mt-2">
          Máximo de leads que entram na campanha, dos melhores para os piores (menos site, mais avaliações). 0 = sem limite.
        </p>
      </div>
    </Modal>
  )
}

// ── Detalhe/progresso de uma campanha ────────────────────────────────────────
function CampaignDetailModal({ campaignId, onClose }: { campaignId: string | null; onClose: () => void }) {
  const [detail, setDetail] = useState<CampaignDetail | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  async function load() {
    if (!campaignId) return
    try {
      const d = await campaignApi.getCampaign(campaignId)
      setDetail(d)
      if (d.status !== 'RUNNING' && pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
    } catch {
      toast.error('Erro ao carregar a campanha')
    }
  }

  useEffect(() => {
    setDetail(null)
    if (!campaignId) return
    load()
    pollRef.current = setInterval(load, 4000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId])

  return (
    <Modal open={!!campaignId} onClose={onClose} title={detail?.name ?? 'Campanha'} size="lg" footer={<Button variant="secondary" onClick={onClose}>Fechar</Button>}>
      {!detail ? (
        <div className="flex justify-center py-10"><Spinner size="lg" /></div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={cn('text-xs font-semibold px-2.5 py-1 rounded-full', CAMPAIGN_STATUS_COLOR[detail.status])}>
              {CAMPAIGN_STATUS_LABEL[detail.status]}
            </span>
            <span className="text-xs text-fg-muted">
              {detail.responsavel ? `Responsável: ${detail.responsavel.name} · ` : ''}Alvo: {PROSPECT_STATUS_LABEL[detail.targetStatus]} · {detail.nichoNome ?? 'Todos os nichos'} · {detail.estado ?? 'Todos os estados'} · {detail.cidade ?? 'Todas as cidades'} · Delay {delayLabel(detail)}{detail.limite ? ` · Limite ${detail.limite}` : ''}
            </span>
          </div>

          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg bg-surface-hover py-2">
              <p className="text-lg font-bold text-fg">{detail.counts.SENT}</p>
              <p className="text-[11px] text-fg-muted">Enviadas</p>
            </div>
            <div className="rounded-lg bg-surface-hover py-2">
              <p className="text-lg font-bold text-fg">{detail.counts.PENDING}</p>
              <p className="text-[11px] text-fg-muted">Pendentes</p>
            </div>
            <div className="rounded-lg bg-surface-hover py-2">
              <p className="text-lg font-bold text-fg">{detail.counts.FAILED}</p>
              <p className="text-[11px] text-fg-muted">Falharam</p>
            </div>
          </div>

          <div className="max-h-96 overflow-y-auto border border-border rounded-lg">
            <table className="w-full">
              <thead className="sticky top-0 bg-surface-hover">
                <tr>
                  {['Nome', 'WhatsApp', 'Status', 'Mensagem'].map((h) => (
                    <th key={h} className="text-left px-3 py-2 text-[11px] font-semibold text-fg-muted uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {detail.recipients.map((r) => (
                  <tr key={r.id} className="border-t border-border">
                    <td className="px-3 py-2 text-xs text-fg">{r.name}</td>
                    <td className="px-3 py-2 text-xs text-fg-muted">{r.phone}</td>
                    <td className="px-3 py-2">
                      <span className={cn('text-[10px] font-semibold px-2 py-0.5 rounded-full', RECIPIENT_STATUS_COLOR[r.status])} title={r.error ?? undefined}>
                        {RECIPIENT_STATUS_LABEL[r.status]}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs text-fg-muted max-w-[240px] truncate" title={r.messageUsed ?? ''}>{r.messageUsed ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Modal>
  )
}

// ── Página principal ──────────────────────────────────────────────────────────
export default function CampanhaPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [loading, setLoading] = useState(true)
  const [formOpen, setFormOpen] = useState(false)
  const [duplicateFrom, setDuplicateFrom] = useState<Campaign | null>(null)
  const [editing, setEditing] = useState<Campaign | null>(null)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [actingId, setActingId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<Campaign | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [searchParams, setSearchParams] = useSearchParams()
  const [prefill, setPrefill] = useState<CampaignPrefill | null>(null)

  // Vindo da Prospecção: ?selecionados=N (ids no sessionStorage) e/ou ?nichoId=&cidade=&status=.
  // Com seleção individual, só os leads escolhidos entram; sem ela, os filtros pré-preenchem o alvo.
  useEffect(() => {
    if (searchParams.size === 0) return
    const status = searchParams.get('status')
    let leadIds: string[] | undefined
    if (searchParams.get('selecionados')) {
      try {
        const raw = JSON.parse(sessionStorage.getItem('campanha:leadIds') ?? '[]')
        if (Array.isArray(raw)) leadIds = raw.filter((v): v is string => typeof v === 'string' && v.length > 0).slice(0, 5000)
        sessionStorage.removeItem('campanha:leadIds')
      } catch { /* ignora */ }
    }
    const found: CampaignPrefill = {
      targetStatus: PROSPECT_STATUS_OPTIONS.find((s) => s === status),
      nichoId: searchParams.get('nichoId') || undefined,
      estado: searchParams.get('estado') || undefined,
      cidade: searchParams.get('cidade') || undefined,
      leadIds: leadIds?.length ? leadIds : undefined,
    }
    const applied = !!(found.leadIds || found.targetStatus || found.nichoId || found.estado || found.cidade)
    if (applied) { setPrefill(found); setDuplicateFrom(null); setEditing(null); setFormOpen(true) }
    if (searchParams.get('selecionados') && !found.leadIds) {
      toast.error('Não foi possível carregar a seleção de leads. Selecione de novo na Prospecção.', { id: 'prospeccao-campanha' })
    }
    setSearchParams({}, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function load() {
    try {
      setCampaigns(await campaignApi.listCampaigns())
    } catch {
      toast.error('Erro ao carregar campanhas')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // Enquanto alguma campanha estiver em andamento, atualiza a lista pra
    // refletir o progresso (contagem de enviadas/pendentes) sem recarregar a
    // página inteira.
    pollRef.current = setInterval(load, 5000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [])

  async function handleStart(campaign: Campaign) {
    setActingId(campaign.id)
    try {
      await campaignApi.startCampaign(campaign.id)
      toast.success('Campanha iniciada')
      await load()
    } catch (err) {
      toast.error(errMsg(err) ?? 'Erro ao iniciar campanha')
    } finally {
      setActingId(null)
    }
  }

  async function handlePause(campaign: Campaign) {
    setActingId(campaign.id)
    try {
      await campaignApi.pauseCampaign(campaign.id)
      toast.success('Campanha pausada')
      await load()
    } catch (err) {
      toast.error(errMsg(err) ?? 'Erro ao pausar campanha')
    } finally {
      setActingId(null)
    }
  }

  async function confirmDelete() {
    if (!deleting) return
    try {
      await campaignApi.deleteCampaign(deleting.id)
      setCampaigns((prev) => prev.filter((c) => c.id !== deleting.id))
      toast.success('Campanha excluída')
      setDeleting(null)
    } catch (err) {
      toast.error(errMsg(err) ?? 'Erro ao excluir campanha')
    }
  }

  return (
    <>
    <PageHeader
      title="Campanha"
      subtitle="Disparo em massa de WhatsApp pra prospects, com variação de mensagem e delay entre envios"
      action={<Button onClick={() => { setDuplicateFrom(null); setEditing(null); setPrefill(null); setFormOpen(true) }}><Plus size={16} /> Nova campanha</Button>}
    />
      <div className="flex flex-col gap-6">
        <WhatsAppConnectionCard />

        {loading ? (
          <div className="flex justify-center py-16"><Spinner size="lg" /></div>
        ) : campaigns.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-fg-muted bg-surface rounded-xl border border-border">
            <Megaphone size={40} className="opacity-30" />
            <p className="text-sm">Nenhuma campanha criada ainda</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {campaigns.map((c) => {
              const progress = c.counts.total > 0 ? Math.round(((c.counts.SENT + c.counts.FAILED + (c.counts.SKIPPED ?? 0)) / c.counts.total) * 100) : 0
              return (
                <div key={c.id} className="bg-surface rounded-xl border border-border p-4 flex flex-col gap-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-fg truncate flex items-center gap-2">
                        {c.name}
                      </p>
                      <p className="text-xs text-fg-muted">
                        {c.responsavel ? `Responsável: ${c.responsavel.name} · ` : <span className="text-tone-red-fg">Sem responsável · </span>}Alvo: {PROSPECT_STATUS_LABEL[c.targetStatus]} · {c.nichoNome ?? 'Todos os nichos'} · {c.estado ?? 'Todos os estados'} · {c.cidade ?? 'Todas as cidades'} · {c.messages.length} variação(ões) · delay {delayLabel(c)}{c.limite ? ` · limite ${c.limite}` : ''}
                      </p>
                    </div>
                    <span className={cn('text-xs font-semibold px-2.5 py-1 rounded-full shrink-0', CAMPAIGN_STATUS_COLOR[c.status])}>
                      {CAMPAIGN_STATUS_LABEL[c.status]}
                    </span>
                  </div>

                  <div className="flex items-center gap-3 text-xs text-fg-muted">
                    <span className="inline-flex items-center gap-1"><Users size={12} /> {c.counts.total} destinatários</span>
                    <span className="inline-flex items-center gap-1"><Send size={12} /> {c.counts.SENT} enviadas</span>
                    {c.counts.FAILED > 0 && <span className="inline-flex items-center gap-1 text-tone-red-solid"><XCircle size={12} /> {c.counts.FAILED} falharam</span>}
                    {c.status === 'RUNNING' && <span className="inline-flex items-center gap-1"><Clock size={12} /> em andamento</span>}
                  </div>

                  <div className="h-1.5 rounded-full bg-surface-hover overflow-hidden">
                    <div className="h-full bg-orange-500 transition-all" style={{ width: `${progress}%` }} />
                  </div>

                  <div className="flex items-center justify-between gap-2 mt-1">
                    <button onClick={() => setDetailId(c.id)} className="text-xs font-semibold text-orange-600 dark:text-orange-400 hover:text-orange-700 dark:hover:text-orange-300">
                      Ver detalhes
                    </button>
                    <div className="flex items-center gap-1.5">
                      {(c.status === 'DRAFT' || c.status === 'PAUSED') && (
                        <Button size="sm" onClick={() => handleStart(c)} loading={actingId === c.id}>
                          <Play size={13} /> Iniciar
                        </Button>
                      )}
                      {c.status === 'RUNNING' && (
                        <Button size="sm" variant="secondary" onClick={() => handlePause(c)} loading={actingId === c.id}>
                          <Pause size={13} /> Pausar
                        </Button>
                      )}
                      <button
                        onClick={() => { setDuplicateFrom(c); setEditing(null); setFormOpen(true) }}
                        className="p-1.5 rounded-lg text-fg-muted hover:text-orange-500 hover:bg-orange-50 dark:hover:bg-orange-900/20 transition-colors"
                        title="Duplicar campanha"
                        aria-label={`Duplicar campanha ${c.name}`}
                      >
                        <Copy size={14} />
                      </button>
                      {(c.status === 'DRAFT' || c.status === 'PAUSED') && (
                        <button
                          onClick={() => { setEditing(c); setDuplicateFrom(null); setPrefill(null); setFormOpen(true) }}
                          className="p-1.5 rounded-lg text-fg-muted hover:text-orange-500 hover:bg-orange-50 dark:hover:bg-orange-900/20 transition-colors"
                          title="Editar campanha"
                          aria-label={`Editar campanha ${c.name}`}
                        >
                          <Pencil size={14} />
                        </button>
                      )}
                      {c.status !== 'RUNNING' && (
                        <button onClick={() => setDeleting(c)} className="p-1.5 rounded-lg text-fg-muted hover:text-tone-red-solid hover:bg-tone-red-bg transition-colors" title="Excluir campanha">
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <NewCampaignModal open={formOpen} duplicateFrom={duplicateFrom} editing={editing} prefill={prefill} onClose={() => setFormOpen(false)} onCreated={load} />
      <CampaignDetailModal campaignId={detailId} onClose={() => setDetailId(null)} />
      <ConfirmDialog
        open={!!deleting}
        title="Excluir campanha"
        message={deleting ? `Excluir a campanha "${deleting.name}"? Essa ação não pode ser desfeita.` : ''}
        confirmLabel="Excluir"
        onConfirm={confirmDelete}
        onClose={() => setDeleting(null)}
      />
    </>
  )
}
