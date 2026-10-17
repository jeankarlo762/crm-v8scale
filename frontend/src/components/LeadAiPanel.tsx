import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { Bot, MessageCircle, Star, UserCheck, Shuffle } from 'lucide-react'
import { Button } from './ui/Button'
import * as aiApi from '../api/ai.api'
import { errMsg } from '../utils/apiError'
import { digitsOnly, timeAgo } from '../utils/format'
import type { LeadDetail } from '../types'

const FIELDS: Array<[keyof NonNullable<LeadDetail['aiQualification']>, string]> = [
  ['interest', 'Procura'], ['budget', 'Orçamento'], ['tradeIn', 'Troca'], ['financing', 'Pagamento'], ['timeline', 'Prazo'],
]

/** Link do WhatsApp do lead já com a abertura que a IA sugeriu para o vendedor. */
export function openingLink(phone: string, message: string | null | undefined): string {
  const d = digitsOnly(phone)
  const base = `https://wa.me/${d.length <= 11 ? `55${d}` : d}`
  return message ? `${base}?text=${encodeURIComponent(message)}` : base
}

interface Props {
  lead: LeadDetail
  canAssign: boolean
  onChanged: () => void
}

export function LeadAiPanel({ lead, canAssign, onChanged }: Props) {
  const [messages, setMessages] = useState<aiApi.AiMessage[]>([])
  const [busy, setBusy] = useState<'assume' | 'pass' | 'review' | null>(null)
  const q = lead.aiQualification
  const hasHistory = lead.aiMessageCount > 0 || lead.aiActive

  useEffect(() => {
    if (!hasHistory) return
    aiApi.listMessages(lead.id).then(setMessages).catch(() => undefined)
  }, [lead.id, lead.aiMessageCount, lead.aiActive, hasHistory])

  async function run(kind: 'assume' | 'pass' | 'review', fn: () => Promise<unknown>, ok: string) {
    setBusy(kind)
    try {
      await fn()
      toast.success(ok)
      onChanged()
    } catch (err) {
      toast.error(errMsg(err) ?? 'Não foi possível concluir a ação')
    } finally {
      setBusy(null)
    }
  }

  const showReview = lead.stage.kind === 'WON' && !!lead.phone
  if (!hasHistory && !showReview) return null

  return (
    <div className="px-6 py-4 border-b border-border">
      {hasHistory && (
        <>
          <div className="flex items-center justify-between gap-2 mb-2">
            <p className="text-sm font-semibold text-fg inline-flex items-center gap-2">
              <Bot size={16} className="text-violet-500" /> Atendimento IA
              {lead.aiActive
                ? <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300">IA atendendo</span>
                : <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-surface-hover text-fg-muted">IA parada</span>}
              {q?.ready && <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-tone-green-bg text-tone-green-fg">Qualificado</span>}
            </p>
          </div>

          {q?.summary && <p className="text-sm text-fg mb-2">{q.summary}</p>}
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 mb-3">
            {FIELDS.map(([key, label]) => (
              <div key={key} className="min-w-0">
                <dt className="text-xs text-fg-muted">{label}</dt>
                <dd className="text-sm text-fg break-words">{(q?.[key] as string | null) || <span className="text-fg-muted">—</span>}</dd>
              </div>
            ))}
          </dl>

          <div className="flex flex-wrap gap-2 mb-3">
            {lead.aiActive && (
              <Button size="sm" loading={busy === 'assume'} onClick={() => void run('assume', () => aiApi.assumeLead(lead.id), 'Você assumiu o atendimento — a IA parou')}>
                <UserCheck size={14} /> Assumir atendimento
              </Button>
            )}
            {lead.phone && (
              <a
                href={openingLink(lead.phone, q?.openingMessage)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-tone-green-bg text-tone-green-fg hover:brightness-95"
              >
                <MessageCircle size={14} /> {q?.openingMessage ? 'Chamar com a abertura sugerida' : 'Chamar no WhatsApp'}
              </a>
            )}
            <Button
              size="sm"
              variant="secondary"
              loading={busy === 'pass'}
              onClick={() => void run('pass', () => aiApi.passLead(lead.id), 'Lead passado para o próximo vendedor')}
              title="Passa para o próximo vendedor da fila"
            >
              <Shuffle size={14} /> Passar para outro vendedor
            </Button>
          </div>
          {q?.openingMessage && <p className="text-xs text-fg-muted mb-3 italic">“{q.openingMessage}”</p>}
          {!canAssign && !lead.ownerId && <p className="text-xs text-fg-muted mb-2">Lead sem vendedor designado.</p>}

          {messages.length > 0 && (
            <details className="rounded-lg border border-border">
              <summary className="cursor-pointer select-none px-3 py-2 text-xs font-medium text-fg-muted">Conversa com a IA ({messages.length})</summary>
              <div className="px-3 pb-3 flex flex-col gap-2 max-h-72 overflow-y-auto">
                {messages.map((m) => (
                  <div key={m.id} className={m.role === 'USER' ? 'self-start max-w-[85%]' : 'self-end max-w-[85%]'}>
                    <p className={`text-sm rounded-lg px-3 py-1.5 ${m.role === 'USER' ? 'bg-surface-hover text-fg' : 'bg-violet-100 text-violet-900 dark:bg-violet-900/30 dark:text-violet-100'}`}>{m.content}</p>
                    <p className="text-[10px] text-fg-muted mt-0.5 px-1">{m.role === 'USER' ? 'Cliente' : 'IA'} · {timeAgo(m.createdAt)}</p>
                  </div>
                ))}
              </div>
            </details>
          )}
        </>
      )}

      {showReview && (
        <div className={hasHistory ? 'mt-4' : ''}>
          <Button
            size="sm"
            variant="secondary"
            loading={busy === 'review'}
            onClick={() => void run('review', () => aiApi.sendReviewRequest(lead.id), 'Pedido de avaliação enviado')}
          >
            <Star size={14} /> {lead.reviewRequestedAt ? 'Reenviar pedido de avaliação' : 'Pedir avaliação no Google'}
          </Button>
          {lead.reviewRequestedAt && <p className="text-xs text-fg-muted mt-1">Enviado {timeAgo(lead.reviewRequestedAt)}.</p>}
        </div>
      )}
    </div>
  )
}
