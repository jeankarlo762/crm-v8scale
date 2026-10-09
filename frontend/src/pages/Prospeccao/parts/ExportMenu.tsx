import { useRef, useState } from 'react'
import { Download, ChevronDown } from 'lucide-react'
import { Spinner } from '../../../components/ui/Spinner'
import { menuClass, menuItemClass, useClickOutside } from './shared'

export function ExportMenu({ exporting, disabled, onExport }: {
  exporting: 'csv' | 'xlsx' | null
  disabled: boolean
  onExport: (format: 'csv' | 'xlsx') => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useClickOutside(ref, () => setOpen(false), open)

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={disabled || exporting !== null}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 h-9 text-sm font-medium rounded-lg text-fg-muted hover:bg-surface-hover hover:text-fg px-4 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {exporting ? <Spinner size="sm" /> : <Download size={15} />} Exportar <ChevronDown size={14} />
      </button>
      {open && (
        <div role="menu" className={`${menuClass} right-0`}>
          {(['csv', 'xlsx'] as const).map((f) => (
            <button key={f} role="menuitem" className={menuItemClass} onClick={() => { setOpen(false); onExport(f) }}>
              {f === 'csv' ? 'CSV (.csv)' : 'Excel (.xlsx)'}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
