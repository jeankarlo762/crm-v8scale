import { useEffect, useRef, useState } from 'react'
import { Gauge, TriangleAlert, PlugZap } from 'lucide-react'
import toast from 'react-hot-toast'
import { cn } from '../../../utils/cn'
import { getConsumo, retomarIntegracao, type Consumo } from '../../../api/lead.api'
import { useClickOutside } from './shared'

const NOME: Record<string, string> = { GOOGLE_TEXT_SEARCH_PRO: 'Google Text Search Pro', GOOGLE_PLACE_DETAILS_ENTERPRISE: 'Google Place Details Enterprise', TAVILY: 'Tavily', META: 'Instagram (Meta)' }
const JANELA: Record<string, string> = { H: 'hora', M: 'mês' }
const BLOQUEIO: Record<string, string> = {
  NOT_CONFIGURED: 'Orçamento não configurado', ABOVE_DOCUMENTED_CAP: 'Orçamento acima da franquia gratuita', INVALID_CONFIG: 'Configuração inválida', PROVIDER_PAUSED: 'Pausado (credencial inválida)',
  WINDOW_H: 'Sem saldo nesta hora', WINDOW_M: 'Sem saldo neste mês', OPERATION_LIMIT: 'Teto da operação atingido', RUN_LIMIT: 'Teto desta execução atingido', STORE_ERROR: 'Contador indisponível (bloqueado por segurança)', CONFIG_CHANGED: 'Ciclo de cota alterado: reconciliar consumo',
}

// Consumo local das APIs externas (orçamento INTERNO, não o limite do provedor) e bloqueios, com o motivo.
export function ConsumoPanel() {
  const [open, setOpen] = useState(false)
  const [data, setData] = useState<Consumo | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [pos, setPos] = useState<{ top: number; right: number }>({ top: 0, right: 16 })
  const ref = useRef<HTMLDivElement>(null)
  useClickOutside(ref, () => setOpen(false), open)

  const load = () => { getConsumo().then(setData).catch(() => {}) }
  useEffect(() => { load() }, [])
  useEffect(() => { if (open) load() }, [open])

  const blocked = data ? Object.values(data.usage).some((p) => p.bloqueio) : false
  async function retomar(provider: string) {
    setBusy(provider)
    try { const r = await retomarIntegracao(provider); toast.success(`Integração retomada (${r.acordados} lead(s) acordado(s))`); load() } catch { toast.error('Não foi possível retomar') } finally { setBusy(null) }
  }

  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setPos({ top: r.bottom + 6, right: Math.max(16, window.innerWidth - r.right) }); setOpen((o) => !o) }} aria-expanded={open} title="Consumo das APIs e bloqueios"
        className={cn('inline-flex items-center gap-1.5 text-xs font-medium rounded-lg border px-2.5 h-9', blocked ? 'border-tone-amber-solid text-tone-amber-fg' : 'border-border text-fg-muted hover:bg-surface-hover hover:text-fg')}>
        {blocked ? <TriangleAlert size={14} /> : <Gauge size={14} />}<span className="hidden md:inline">Consumo</span>
      </button>
      {open && data && (
        <div style={{ top: pos.top, right: pos.right, maxHeight: `calc(100vh - ${pos.top}px - 16px)` }} className="fixed z-40 w-[24rem] max-w-[calc(100vw-2rem)] overflow-y-auto overflow-x-hidden rounded-xl border border-border bg-surface shadow-lg p-4 flex flex-col gap-3 text-left">
          {(Object.keys(data.usage) as (keyof Consumo['usage'])[]).map((k) => {
            const p = data.usage[k]
            const pausa = data.integracoes.find((i) => i.provider === (k.startsWith('GOOGLE_') ? 'GOOGLE_PLACES' : k)) // as duas operações do Google compartilham a credencial
            return (
              <div key={k} className="flex flex-col gap-1 min-w-0 break-words [overflow-wrap:anywhere] pb-3 border-b border-divider last:border-0 last:pb-0">
                <div className="flex items-start justify-between gap-2">
                  <span className="text-sm font-semibold text-fg min-w-0">{NOME[k]}</span>
                  {p.bloqueio ? <span className="shrink-0 text-[11px] font-medium rounded-full px-2 py-0.5 bg-tone-amber-solid/15 text-tone-amber-fg">{BLOQUEIO[p.bloqueio.code] ?? p.bloqueio.code}</span> : <span className="shrink-0 text-[11px] font-medium rounded-full px-2 py-0.5 bg-tone-green-solid/15 text-tone-green-fg">Ativo</span>}
                </div>
                {(['H', 'M'] as const).filter((w) => p.janelas[w].orcamento != null).map((w) => (
                  <p key={w} className="text-xs text-fg-muted tabular-nums">Por {JANELA[w]}: {p.janelas[w].usado} de {p.janelas[w].efetivo} (saldo {p.janelas[w].saldo}){p.janelas[w].proximoReset ? ` · próximo reset ${new Date(p.janelas[w].proximoReset as string).toLocaleString('pt-BR')}` : ''}</p>
                ))}
                {p.capGratuitoDocumentado && <p className="text-[11px] text-fg-muted">Franquia gratuita documentada: {p.capGratuitoDocumentado}/mês</p>}
                {p.bloqueio && <p className="text-xs text-tone-amber-fg">{p.bloqueio.detail}{p.bloqueio.retryAt ? ` · libera em ${new Date(p.bloqueio.retryAt).toLocaleString('pt-BR')}` : ''}</p>}
                {pausa && (
                  <button type="button" disabled={busy === k} onClick={() => retomar(k)} className="self-start inline-flex items-center gap-1 text-xs font-medium text-orange-600 dark:text-orange-400 hover:underline disabled:opacity-50">
                    <PlugZap size={12} />Credencial corrigida? Retomar integração
                  </button>
                )}
              </div>
            )
          })}
          <p className="text-[11px] text-fg-muted border-t border-divider pt-2 break-words [overflow-wrap:anywhere]">
            Poupadas por cache: {data.metrics.callsSavedByCache} · negadas por orçamento: {data.metrics.callsSkippedByQuota}. {data.limitacoes[0]}
          </p>
        </div>
      )}
    </div>
  )
}
