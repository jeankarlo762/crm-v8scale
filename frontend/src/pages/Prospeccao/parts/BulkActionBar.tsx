import { useRef, useState } from 'react'
import { MessageCircle, UserPlus, ListChecks, Trash2, X, ChevronUp } from 'lucide-react'
import { Button } from '../../../components/ui/Button'
import type { StatusContato, Responsavel } from '../../../api/lead.api'
import { CONTATO_LABEL, CONTATO_OPTIONS, ResponsavelMenuItems, menuClass, menuItemClass, useClickOutside } from './shared'

const barBtn = 'inline-flex items-center gap-1.5 text-sm font-medium rounded-lg border border-border bg-surface text-fg hover:bg-surface-hover px-3 py-2 disabled:opacity-50'

function UpMenu({ label, icon, disabled, children }: { label: string; icon: React.ReactNode; disabled: boolean; children: (close: () => void) => React.ReactNode }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useClickOutside(ref, () => setOpen(false), open)
  return (
    <div ref={ref} className="relative">
      <button type="button" className={barBtn} disabled={disabled} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {icon} {label} <ChevronUp size={13} />
      </button>
      {open && <div role="menu" className={`${menuClass} bottom-full mb-1.5 mt-0 left-0`}>{children(() => setOpen(false))}</div>}
    </div>
  )
}

export function BulkActionBar({
  count, total, allSelected, busy, onSelectAll, onClear, onCampaign, onStatus, onResponsavel, onDelete,
}: {
  count: number
  total: number
  allSelected: boolean
  busy: boolean
  onSelectAll: () => void
  onClear: () => void
  onCampaign: () => void
  onStatus: (s: StatusContato) => void
  onResponsavel: (r: Responsavel | null) => void
  onDelete: () => void
}) {
  if (count === 0) return null
  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 w-[calc(100%-2rem)] max-w-4xl">
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-surface shadow-xl px-4 py-3">
        <span className="text-sm font-semibold text-fg tabular-nums">{count} selecionado(s)</span>
        {!allSelected && (
          <button type="button" onClick={onSelectAll} className="text-sm font-medium text-orange-600 dark:text-orange-400 hover:underline">
            Selecionar os {total} filtrados
          </button>
        )}
        <span className="hidden sm:block h-6 w-px bg-border" />
        <Button onClick={onCampaign} disabled={busy}><MessageCircle size={15} /> Enviar campanha WhatsApp</Button>
        <UpMenu label="Atribuir responsável" icon={<UserPlus size={15} />} disabled={busy}>
          {(close) => (
            <>
              <ResponsavelMenuItems onSelect={(r) => { close(); onResponsavel(r) }} />
              <button role="menuitem" className={menuItemClass} onClick={() => { close(); onResponsavel(null) }}>Sem responsável</button>
            </>
          )}
        </UpMenu>
        <UpMenu label="Mudar status" icon={<ListChecks size={15} />} disabled={busy}>
          {(close) => CONTATO_OPTIONS.map((s) => <button key={s} role="menuitem" className={menuItemClass} onClick={() => { close(); onStatus(s) }}>{CONTATO_LABEL[s]}</button>)}
        </UpMenu>
        <button type="button" className={`${barBtn} text-tone-red-fg`} onClick={onDelete} disabled={busy}><Trash2 size={15} /> Excluir</button>
        <button type="button" onClick={onClear} className="ml-auto p-1.5 rounded-lg text-fg-muted hover:bg-surface-hover" aria-label="Limpar seleção" title="Limpar seleção"><X size={16} /></button>
      </div>
    </div>
  )
}
