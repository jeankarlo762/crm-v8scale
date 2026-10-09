import { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react'
import { PageHeader } from '../../components/layout/AppLayout'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { Spinner } from '../../components/ui/Spinner'
import * as api from '../../api/commercial.api'
import { errMsg } from '../../utils/apiError'
import type { Stage, StageKind } from '../../types'

const KIND_OPTIONS: Array<{ value: StageKind; label: string; hint: string }> = [
  { value: 'OPEN', label: 'Em andamento', hint: 'Lead ainda em negociação' },
  { value: 'WON', label: 'Ganho', hint: 'Vira cliente automaticamente' },
  { value: 'LOST', label: 'Perdido', hint: 'Exige motivo da perda' },
]

function StageRow({
  stage, index, total, onSave, onMove, onDelete,
}: {
  stage: Stage
  index: number
  total: number
  onSave: (id: string, patch: { name?: string; color?: string; kind?: StageKind }) => void
  onMove: (index: number, dir: -1 | 1) => void
  onDelete: (stage: Stage) => void
}) {
  const [name, setName] = useState(stage.name)
  const [color, setColor] = useState(stage.color)

  // Mantém os campos em sincronia quando a lista é recarregada.
  useEffect(() => setName(stage.name), [stage.name])
  useEffect(() => setColor(stage.color), [stage.color])

  // O seletor de cor dispara a cada movimento do mouse: só salva quando para de mexer.
  useEffect(() => {
    if (color === stage.color) return
    const t = setTimeout(() => onSave(stage.id, { color }), 500)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [color])

  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3">
      <input
        type="color"
        value={color}
        onChange={(e) => setColor(e.target.value)}
        aria-label={`Cor da etapa ${stage.name}`}
        className="w-9 h-9 rounded-lg border border-border bg-transparent cursor-pointer p-0.5"
      />
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => {
          const trimmed = name.trim()
          if (!trimmed) setName(stage.name)
          else if (trimmed !== stage.name) onSave(stage.id, { name: trimmed })
        }}
        aria-label="Nome da etapa"
        className="flex-1 min-w-[160px] rounded-lg border border-border bg-surface px-3 py-2 text-sm text-fg focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-400"
      />
      <select
        value={stage.kind}
        onChange={(e) => onSave(stage.id, { kind: e.target.value as StageKind })}
        aria-label="Tipo da etapa"
        title={KIND_OPTIONS.find((k) => k.value === stage.kind)?.hint}
        className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-fg focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-400"
      >
        {KIND_OPTIONS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
      </select>
      <div className="flex items-center gap-1">
        <button onClick={() => onMove(index, -1)} disabled={index === 0} aria-label="Mover para cima" className="p-2 rounded-lg text-fg-muted hover:bg-surface-hover disabled:opacity-30 disabled:cursor-not-allowed">
          <ArrowUp size={15} />
        </button>
        <button onClick={() => onMove(index, 1)} disabled={index === total - 1} aria-label="Mover para baixo" className="p-2 rounded-lg text-fg-muted hover:bg-surface-hover disabled:opacity-30 disabled:cursor-not-allowed">
          <ArrowDown size={15} />
        </button>
        <button onClick={() => onDelete(stage)} aria-label="Excluir etapa" className="p-2 rounded-lg text-fg-muted hover:bg-tone-red-bg hover:text-tone-red-fg">
          <Trash2 size={15} />
        </button>
      </div>
    </li>
  )
}

export default function SettingsPage() {
  const [stages, setStages] = useState<Stage[]>([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [deleting, setDeleting] = useState<Stage | null>(null)
  const [deletingBusy, setDeletingBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      setStages(await api.listStages())
    } catch (err) {
      toast.error(errMsg(err) ?? 'Erro ao carregar o funil')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  async function save(id: string, patch: { name?: string; color?: string; kind?: StageKind }) {
    // Atualização otimista (o seletor de cor dispara a cada movimento).
    setStages((s) => s.map((x) => (x.id === id ? { ...x, ...patch } : x)))
    try {
      await api.updateStage(id, patch)
    } catch (err) {
      toast.error(errMsg(err) ?? 'Não foi possível salvar a etapa')
      await load()
    }
  }

  async function move(index: number, dir: -1 | 1) {
    const next = [...stages]
    const target = index + dir
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    setStages(next)
    try {
      setStages(await api.reorderStages(next.map((s) => s.id)))
    } catch (err) {
      toast.error(errMsg(err) ?? 'Não foi possível reordenar')
      await load()
    }
  }

  async function add() {
    setAdding(true)
    try {
      const created = await api.createStage({ name: 'Nova etapa', color: '#64748b', kind: 'OPEN' })
      setStages((s) => [...s, created])
    } catch (err) {
      toast.error(errMsg(err) ?? 'Não foi possível criar a etapa')
    } finally {
      setAdding(false)
    }
  }

  async function confirmDelete() {
    if (!deleting) return
    setDeletingBusy(true)
    try {
      await api.deleteStage(deleting.id)
      toast.success('Etapa excluída')
      setDeleting(null)
      await load()
    } catch (err) {
      toast.error(errMsg(err) ?? 'Não foi possível excluir a etapa')
      setDeleting(null)
    } finally {
      setDeletingBusy(false)
    }
  }

  return (
    <>
      <PageHeader title="Configurações" subtitle="Personalize o funil de vendas do comercial" />

      <Card padding={false} className="max-w-4xl">
        <div className="px-4 py-4 border-b border-border">
          <h2 className="text-base font-semibold text-fg">Etapas do funil</h2>
          <p className="text-sm text-fg-muted mt-1">
            A ordem aqui é a ordem das colunas no Funil. Etapas do tipo <strong>Ganho</strong> criam o cliente automaticamente
            e as do tipo <strong>Perdido</strong> pedem o motivo da perda.
          </p>
        </div>

        {loading ? (
          <div className="flex justify-center py-12"><Spinner size="lg" className="text-orange-500" /></div>
        ) : (
          <ul className="divide-y divide-border">
            {stages.map((s, i) => (
              <StageRow key={s.id} stage={s} index={i} total={stages.length} onSave={save} onMove={move} onDelete={setDeleting} />
            ))}
          </ul>
        )}

        <div className="px-4 py-4 border-t border-border">
          <Button variant="secondary" onClick={add} loading={adding}><Plus size={16} /> Adicionar etapa</Button>
        </div>
      </Card>

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={confirmDelete}
        loading={deletingBusy}
        title="Excluir etapa"
        message={`Excluir a etapa "${deleting?.name}"? Só é possível se ela não tiver nenhum lead.`}
        confirmLabel="Excluir"
      />
    </>
  )
}
