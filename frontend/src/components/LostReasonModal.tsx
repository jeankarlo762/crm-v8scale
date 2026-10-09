import { useEffect, useState } from 'react'
import { Modal } from './ui/Modal'
import { Button } from './ui/Button'
import { Textarea } from './ui/Textarea'

const SUGGESTIONS = ['Sem orçamento', 'Escolheu concorrente', 'Sem retorno', 'Não tem interesse', 'Fora do perfil']

interface Props {
  open: boolean
  leadName: string
  loading?: boolean
  onClose: () => void
  onConfirm: (reason: string) => void
}

export function LostReasonModal({ open, leadName, loading, onClose, onConfirm }: Props) {
  const [reason, setReason] = useState('')

  useEffect(() => {
    if (open) setReason('')
  }, [open])

  const trimmed = reason.trim()

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Marcar como perdido"
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={loading}>Cancelar</Button>
          <Button variant="danger" onClick={() => onConfirm(trimmed)} disabled={!trimmed} loading={loading}>
            Confirmar perda
          </Button>
        </>
      }
    >
      <p className="text-sm text-fg-muted mb-3">
        Por que <strong className="text-fg">{leadName}</strong> foi perdido? Esse motivo fica registrado no histórico do lead.
      </p>
      <div className="flex flex-wrap gap-1.5 mb-3">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setReason(s)}
            className="px-2.5 py-1 rounded-full text-xs border border-border text-fg-muted hover:bg-surface-hover hover:text-fg transition-colors"
          >
            {s}
          </button>
        ))}
      </div>
      <Textarea
        label="Motivo"
        rows={3}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Descreva o motivo da perda"
        autoFocus
      />
    </Modal>
  )
}
