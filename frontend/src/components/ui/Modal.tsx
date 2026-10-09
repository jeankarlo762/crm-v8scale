import { useEffect, ReactNode } from 'react'
import { X } from 'lucide-react'
import { cn } from '../../utils/cn'

interface ModalProps {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  footer?: ReactNode
  /** Ícones/ações compactas exibidas no cabeçalho, antes do botão de fechar. */
  headerActions?: ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl'
}

const sizes = {
  sm: 'max-w-md',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
}

export function Modal({ open, onClose, title, children, footer, headerActions, size = 'md' }: ModalProps) {
  useEffect(() => {
    if (!open) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div
        className="absolute inset-0 bg-overlay/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        className={cn(
          'relative w-full bg-surface rounded-xl shadow-xl flex flex-col max-h-[90vh]',
          sizes[size],
        )}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <h2 className="text-lg font-semibold text-fg">{title}</h2>
          <div className="flex items-center gap-1">
            {headerActions}
            <button
              onClick={onClose}
              aria-label="Fechar"
              className="rounded-lg p-1 text-fg-muted hover:text-fg hover:bg-surface-hover transition-colors"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        <div className="overflow-y-auto flex-1 px-6 py-4">{children}</div>

        {footer && (
          <div className="px-6 py-4 border-t border-border flex flex-wrap justify-end gap-3 shrink-0">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}
