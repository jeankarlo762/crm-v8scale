import { useCallback, useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import {
  DndContext, DragOverlay, PointerSensor, useDraggable, useDroppable, useSensor, useSensors,
  type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core'
import { Plus, Search, CheckSquare, Clock } from 'lucide-react'
import { PageHeader } from '../../components/layout/AppLayout'
import { Button } from '../../components/ui/Button'
import { Spinner } from '../../components/ui/Spinner'
import { Select } from '../../components/ui/Select'
import { LeadDrawer } from '../../components/LeadDrawer'
import { LeadFormModal } from '../../components/LeadFormModal'
import { LostReasonModal } from '../../components/LostReasonModal'
import { useCommercialData } from '../../hooks/useCommercialData'
import * as api from '../../api/commercial.api'
import { errMsg } from '../../utils/apiError'
import { cn } from '../../utils/cn'
import { daysSince, formatCompactCurrency, formatCurrency, initials } from '../../utils/format'
import type { Lead, Stage } from '../../types'

function LeadCardView({ lead, dragging }: { lead: Lead; dragging?: boolean }) {
  const days = daysSince(lead.stageChangedAt)
  return (
    <div
      className={cn(
        'rounded-lg border border-border bg-surface p-3 shadow-sm text-left transition-shadow',
        dragging ? 'shadow-lg rotate-1' : 'hover:shadow-md',
      )}
    >
      <p className="text-sm font-semibold text-fg truncate">{lead.name}</p>
      {lead.contactName && <p className="text-xs text-fg-muted truncate">{lead.contactName}</p>}
      <p className="text-sm font-medium text-fg mt-2">{formatCurrency(lead.value)}</p>
      <div className="flex items-center justify-between gap-2 mt-2">
        <div className="flex items-center gap-2 text-xs text-fg-muted min-w-0">
          <span className="inline-flex items-center gap-1" title="Tempo na etapa"><Clock size={12} />{days}d</span>
          {lead.openTasks > 0 && (
            <span className="inline-flex items-center gap-1 text-tone-amber-fg bg-tone-amber-bg rounded-full px-1.5 py-0.5" title="Tarefas abertas">
              <CheckSquare size={11} />{lead.openTasks}
            </span>
          )}
          {lead.source && <span className="truncate">{lead.source}</span>}
        </div>
        {lead.owner && (
          <span
            title={lead.owner.name}
            className="w-6 h-6 rounded-full bg-primary-soft text-primary-soft-fg text-[10px] font-bold flex items-center justify-center shrink-0"
          >
            {initials(lead.owner.name)}
          </span>
        )}
      </div>
    </div>
  )
}

function DraggableLead({ lead, onOpen }: { lead: Lead; onOpen: (id: string) => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: lead.id })
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={() => onOpen(lead.id)}
      className={cn('cursor-grab active:cursor-grabbing touch-none', isDragging && 'opacity-40')}
    >
      <LeadCardView lead={lead} />
    </div>
  )
}

function Column({ stage, leads, onOpen, onAdd }: { stage: Stage; leads: Lead[]; onOpen: (id: string) => void; onAdd?: () => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id })
  const total = leads.reduce((sum, l) => sum + l.value, 0)

  return (
    <div className="w-72 shrink-0 flex flex-col">
      <div className="flex items-center justify-between gap-2 mb-2 px-1">
        <div className="flex items-center gap-2 min-w-0">
          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: stage.color }} />
          <h3 className="text-sm font-semibold text-fg truncate">{stage.name}</h3>
          <span className="text-xs text-fg-muted bg-surface-hover rounded-full px-2 py-0.5">{leads.length}</span>
        </div>
        {onAdd && (
          <button onClick={onAdd} aria-label={`Novo lead em ${stage.name}`} className="p-1 rounded-lg text-fg-muted hover:bg-surface-hover hover:text-fg">
            <Plus size={16} />
          </button>
        )}
      </div>
      <p className="text-xs text-fg-muted px-1 mb-2">{formatCompactCurrency(total)}</p>
      <div
        ref={setNodeRef}
        className={cn(
          'flex-1 rounded-xl p-2 flex flex-col gap-2 min-h-[120px] max-h-[calc(100vh-300px)] overflow-y-auto transition-colors',
          'bg-surface-hover/60 border-t-2',
          isOver && 'bg-primary-soft/50 ring-2 ring-orange-400',
        )}
        style={{ borderTopColor: stage.color }}
      >
        {leads.map((lead) => (
          <DraggableLead key={lead.id} lead={lead} onOpen={onOpen} />
        ))}
        {leads.length === 0 && <p className="text-xs text-fg-muted text-center py-6">Arraste leads para cá</p>}
      </div>
    </div>
  )
}

export default function PipelinePage() {
  const { stages, users, canAssign } = useCommercialData()
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [ownerFilter, setOwnerFilter] = useState('')

  const [activeId, setActiveId] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [formStageId, setFormStageId] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [lostPending, setLostPending] = useState<{ lead: Lead; target: Stage } | null>(null)
  const [movingLost, setMovingLost] = useState(false)

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      setLeads(await api.listLeads())
    } catch (err) {
      toast.error(errMsg(err) ?? 'Erro ao carregar o funil')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const closeDrawer = useCallback(() => setOpenId(null), [])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return leads.filter((l) => {
      if (ownerFilter && l.ownerId !== ownerFilter) return false
      if (!q) return true
      return [l.name, l.contactName, l.email, l.phone].some((v) => v?.toLowerCase().includes(q))
    })
  }, [leads, search, ownerFilter])

  const byStage = useMemo(() => {
    const map = new Map<string, Lead[]>()
    for (const s of stages) map.set(s.id, [])
    for (const l of visible) map.get(l.stageId)?.push(l)
    return map
  }, [stages, visible])

  async function moveLead(lead: Lead, target: Stage, lostReason?: string) {
    const previous = leads
    // Atualização otimista: o card muda de coluna na hora e volta se a API falhar.
    setLeads((ls) =>
      ls.map((l) => (l.id === lead.id ? { ...l, stageId: target.id, stage: target, stageChangedAt: new Date().toISOString() } : l)),
    )
    try {
      await api.changeLeadStage(lead.id, target.id, lostReason)
      if (target.kind === 'WON') toast.success('Lead ganho — cliente criado!')
      void load(true)
    } catch (err) {
      setLeads(previous)
      toast.error(errMsg(err) ?? 'Não foi possível mover o lead')
    }
  }

  function handleDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id))
  }

  function handleDragEnd(e: DragEndEvent) {
    setActiveId(null)
    if (!e.over) return
    const lead = leads.find((l) => l.id === e.active.id)
    const target = stages.find((s) => s.id === e.over!.id)
    if (!lead || !target || lead.stageId === target.id) return
    if (target.kind === 'LOST') {
      setLostPending({ lead, target })
      return
    }
    void moveLead(lead, target)
  }

  async function confirmLost(reason: string) {
    if (!lostPending) return
    setMovingLost(true)
    await moveLead(lostPending.lead, lostPending.target, reason)
    setMovingLost(false)
    setLostPending(null)
  }

  const activeLead = activeId ? leads.find((l) => l.id === activeId) : undefined
  const firstOpenStage = stages.find((s) => s.kind === 'OPEN')

  return (
    <>
      <PageHeader
        title="Funil de vendas"
        subtitle="Arraste os cards entre as etapas para atualizar o andamento"
        action={
          <Button onClick={() => { setFormStageId(null); setFormOpen(true) }}>
            <Plus size={16} /> Novo lead
          </Button>
        }
      />

      <div className="flex flex-col sm:flex-row gap-3 mb-5">
        <div className="relative flex-1 max-w-sm">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nome, contato, e-mail ou telefone"
            className="w-full rounded-lg border border-border bg-surface pl-9 pr-3 py-2 text-sm text-fg placeholder:text-fg-muted focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-400"
          />
        </div>
        {canAssign && (
          <div className="sm:w-56">
            <Select
              aria-label="Filtrar por responsável"
              value={ownerFilter}
              onChange={(e) => setOwnerFilter(e.target.value)}
              options={[{ value: '', label: 'Todos os responsáveis' }, ...users.map((u) => ({ value: u.id, label: u.name }))]}
            />
          </div>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><Spinner size="lg" className="text-orange-500" /></div>
      ) : (
        <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd} onDragCancel={() => setActiveId(null)}>
          <div className="overflow-x-auto pb-4 -mx-4 px-4 sm:mx-0 sm:px-0">
            <div className="flex gap-4 min-w-max">
              {stages.map((stage) => (
                <Column
                  key={stage.id}
                  stage={stage}
                  leads={byStage.get(stage.id) ?? []}
                  onOpen={setOpenId}
                  onAdd={stage.kind === 'OPEN' ? () => { setFormStageId(stage.id); setFormOpen(true) } : undefined}
                />
              ))}
            </div>
          </div>
          <DragOverlay>{activeLead ? <LeadCardView lead={activeLead} dragging /> : null}</DragOverlay>
        </DndContext>
      )}

      <LeadDrawer leadId={openId} stages={stages} users={users} onClose={closeDrawer} onChanged={() => void load(true)} />

      <LeadFormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        stages={stages}
        users={users}
        canAssign={canAssign}
        defaultStageId={formStageId ?? firstOpenStage?.id}
        onSaved={() => void load(true)}
      />

      <LostReasonModal
        open={!!lostPending}
        leadName={lostPending?.lead.name ?? ''}
        loading={movingLost}
        onClose={() => setLostPending(null)}
        onConfirm={(reason) => void confirmLost(reason)}
      />
    </>
  )
}
