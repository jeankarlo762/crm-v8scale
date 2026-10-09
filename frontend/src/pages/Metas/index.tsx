import { useCallback, useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { Plus, Pencil, Trash2, Trophy, Users as UsersIcon, User as UserIcon } from 'lucide-react'
import { PageHeader } from '../../components/layout/AppLayout'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { Input } from '../../components/ui/Input'
import { Select } from '../../components/ui/Select'
import { Textarea } from '../../components/ui/Textarea'
import { Modal } from '../../components/ui/Modal'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { EmptyState } from '../../components/ui/EmptyState'
import { Spinner } from '../../components/ui/Spinner'
import { useCommercialData } from '../../hooks/useCommercialData'
import * as api from '../../api/commercial.api'
import type { Goal, GoalInput, GoalMetric, GoalPeriodFilter } from '../../api/commercial.api'
import { errMsg } from '../../utils/apiError'
import { cn } from '../../utils/cn'
import { formatCurrency } from '../../utils/format'

const METRICS: Record<GoalMetric, { label: string; hint: string; money: boolean }> = {
  WON_VALUE: { label: 'Valor vendido (R$)', hint: 'Soma do valor dos leads ganhos no período', money: true },
  WON_COUNT: { label: 'Negócios fechados', hint: 'Quantidade de leads ganhos no período', money: false },
  LEADS_CREATED: { label: 'Novos leads', hint: 'Leads criados no período', money: false },
  ACTIVITIES: { label: 'Contatos realizados', hint: 'Notas, ligações, WhatsApp, e-mails e reuniões registrados', money: false },
}
const METRIC_OPTIONS = (Object.keys(METRICS) as GoalMetric[]).map((m) => ({ value: m, label: METRICS[m].label }))

const PERIOD_OPTIONS: { value: GoalPeriodFilter; label: string }[] = [
  { value: 'current', label: 'Em andamento' },
  { value: 'upcoming', label: 'Futuras' },
  { value: 'past', label: 'Encerradas' },
  { value: 'all', label: 'Todas' },
]

const TZ = 'America/Sao_Paulo'
const fmtDay = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: TZ })
const fmtShort = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit', year: '2-digit' })

/** Atalhos de período, calculados sobre "hoje" em Brasília. */
function presets(): { label: string; start: string; end: string }[] {
  const [y, m] = fmtDay(new Date()).split('-').map(Number)
  const day = (yy: number, mm: number, dd: number) => fmtDay(new Date(Date.UTC(yy, mm - 1, dd, 12)))
  const lastDay = (yy: number, mm: number) => new Date(Date.UTC(yy, mm, 0)).getUTCDate()
  const q = Math.floor((m - 1) / 3)
  const nm = m === 12 ? 1 : m + 1
  const ny = m === 12 ? y + 1 : y
  return [
    { label: 'Este mês', start: day(y, m, 1), end: day(y, m, lastDay(y, m)) },
    { label: 'Próximo mês', start: day(ny, nm, 1), end: day(ny, nm, lastDay(ny, nm)) },
    { label: 'Este trimestre', start: day(y, q * 3 + 1, 1), end: day(y, q * 3 + 3, lastDay(y, q * 3 + 3)) },
    { label: 'Este ano', start: day(y, 1, 1), end: day(y, 12, 31) },
  ]
}

function formatValue(metric: GoalMetric, v: number): string {
  return METRICS[metric].money ? formatCurrency(v) : new Intl.NumberFormat('pt-BR').format(v)
}

function barColor(percent: number, status: Goal['status']): string {
  if (percent >= 100) return 'bg-tone-green-solid'
  if (status === 'ENDED') return 'bg-tone-red-solid'
  return 'bg-orange-500'
}

interface FormState { title: string; metric: GoalMetric; target: string; periodStart: string; periodEnd: string; ownerId: string; notes: string }

function emptyForm(): FormState {
  const p = presets()[0]
  return { title: '', metric: 'WON_VALUE', target: '', periodStart: p.start, periodEnd: p.end, ownerId: '', notes: '' }
}

function GoalCard({ goal, canManage, onEdit, onDelete }: { goal: Goal; canManage: boolean; onEdit: () => void; onDelete: () => void }) {
  const m = METRICS[goal.metric]
  const pct = Math.min(goal.percent, 100)
  const left = Math.max(goal.target - goal.current, 0)
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-fg truncate">{goal.title || m.label}</p>
          <p className="text-xs text-fg-muted mt-0.5">{goal.title ? `${m.label} · ` : ''}{fmtShort(goal.periodStart)} a {fmtShort(goal.periodEnd)}</p>
        </div>
        {canManage && (
          <div className="flex shrink-0">
            <button onClick={onEdit} aria-label="Editar meta" className="p-2 rounded-lg text-fg-muted hover:bg-surface-hover hover:text-fg"><Pencil size={15} /></button>
            <button onClick={onDelete} aria-label="Excluir meta" className="p-2 rounded-lg text-fg-muted hover:bg-tone-red-bg hover:text-tone-red-fg"><Trash2 size={15} /></button>
          </div>
        )}
      </div>

      <div className="inline-flex items-center gap-1.5 text-xs text-fg-muted">
        {goal.owner ? <><UserIcon size={12} /> {goal.owner.name}</> : <><UsersIcon size={12} /> Equipe toda</>}
        {goal.status === 'UPCOMING' && <span className="ml-2 rounded-full bg-surface-hover px-2 py-0.5">começa em {fmtShort(goal.periodStart)}</span>}
        {goal.status === 'ENDED' && <span className="ml-2 rounded-full bg-surface-hover px-2 py-0.5">encerrada</span>}
      </div>

      <div>
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-2xl font-bold text-fg tabular-nums">{formatValue(goal.metric, goal.current)}</p>
          <p className="text-sm text-fg-muted tabular-nums">de {formatValue(goal.metric, goal.target)}</p>
        </div>
        <div className="mt-2 h-2.5 rounded-full bg-surface-hover overflow-hidden" role="progressbar" aria-valuenow={Math.round(goal.percent)} aria-valuemin={0} aria-valuemax={100}>
          <div className={cn('h-full rounded-full transition-all', barColor(goal.percent, goal.status))} style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-1.5 text-xs text-fg-muted">
          {goal.percent >= 100
            ? <span className="inline-flex items-center gap-1 text-tone-green-fg font-medium"><Trophy size={12} /> Meta batida · {goal.percent.toLocaleString('pt-BR')}%</span>
            : `${goal.percent.toLocaleString('pt-BR')}% · faltam ${formatValue(goal.metric, left)}`}
        </p>
      </div>
      {goal.notes && <p className="text-xs text-fg-muted border-t border-border pt-2">{goal.notes}</p>}
    </Card>
  )
}

export default function MetasPage() {
  const { users, canAssign: canManage } = useCommercialData()
  const [period, setPeriod] = useState<GoalPeriodFilter>('current')
  const [ownerFilter, setOwnerFilter] = useState('')
  const [goals, setGoals] = useState<Goal[]>([])
  const [loading, setLoading] = useState(true)

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Goal | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({})
  const [saving, setSaving] = useState(false)

  const [toDelete, setToDelete] = useState<Goal | null>(null)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      setGoals(await api.listGoals({ period, ownerId: ownerFilter || undefined }))
    } catch (err) {
      toast.error(errMsg(err) ?? 'Não foi possível carregar as metas')
    } finally {
      setLoading(false)
    }
  }, [period, ownerFilter])

  useEffect(() => { void load() }, [load])

  const summary = useMemo(() => {
    const hit = goals.filter((g) => g.percent >= 100).length
    return `${goals.length} meta(s)${goals.length ? ` · ${hit} batida(s)` : ''}`
  }, [goals])

  function set<K extends keyof FormState>(k: K, v: FormState[K]) {
    setForm((f) => ({ ...f, [k]: v }))
    setErrors((e) => ({ ...e, [k]: undefined }))
  }

  function openNew() {
    setEditing(null)
    setForm(emptyForm())
    setErrors({})
    setFormOpen(true)
  }

  function openEdit(g: Goal) {
    setEditing(g)
    setForm({
      title: g.title ?? '', metric: g.metric, target: String(g.target),
      periodStart: fmtDay(new Date(g.periodStart)), periodEnd: fmtDay(new Date(g.periodEnd)),
      ownerId: g.ownerId ?? '', notes: g.notes ?? '',
    })
    setErrors({})
    setFormOpen(true)
  }

  async function save() {
    const next: typeof errors = {}
    const target = Number(form.target.replace(',', '.'))
    if (!form.target.trim() || !isFinite(target) || target <= 0) next.target = 'Informe uma meta maior que zero'
    if (!form.periodStart) next.periodStart = 'Informe o início'
    if (!form.periodEnd) next.periodEnd = 'Informe o fim'
    if (form.periodStart && form.periodEnd && form.periodStart > form.periodEnd) next.periodEnd = 'O fim deve ser depois do início'
    if (Object.keys(next).length) { setErrors(next); return }

    const payload: GoalInput = {
      title: form.title.trim() || null, metric: form.metric, target,
      periodStart: form.periodStart, periodEnd: form.periodEnd,
      ownerId: form.ownerId || null, notes: form.notes.trim() || null,
    }
    setSaving(true)
    try {
      if (editing) await api.updateGoal(editing.id, payload)
      else await api.createGoal(payload)
      toast.success(editing ? 'Meta atualizada' : 'Meta criada')
      setFormOpen(false)
      // Mostra a meta salva: se o período ou o vendedor dela ficam fora dos filtros atuais, ajusta os filtros
      // (senão ela some da lista e parece que a meta não foi criada).
      const today = fmtDay(new Date())
      const nextPeriod: GoalPeriodFilter = payload.periodEnd < today ? 'past' : payload.periodStart > today ? 'upcoming' : 'current'
      const hiddenByOwner = !!ownerFilter && ownerFilter !== (payload.ownerId ?? 'team')
      if (nextPeriod !== period || hiddenByOwner) {
        setPeriod(nextPeriod)
        if (hiddenByOwner) setOwnerFilter('')
        toast(`Mostrando metas ${PERIOD_OPTIONS.find((o) => o.value === nextPeriod)?.label.toLowerCase()}`, { icon: 'ℹ️' })
      } else {
        await load(true)
      }
    } catch (err) {
      toast.error(errMsg(err) ?? 'Não foi possível salvar a meta')
    } finally {
      setSaving(false)
    }
  }

  async function confirmDelete() {
    if (!toDelete) return
    setDeleting(true)
    try {
      await api.deleteGoal(toDelete.id)
      toast.success('Meta excluída')
      setToDelete(null)
      await load(true)
    } catch (err) {
      toast.error(errMsg(err) ?? 'Não foi possível excluir a meta')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <>
      <PageHeader
        title="Metas"
        subtitle={summary}
        action={canManage ? <Button onClick={openNew}><Plus size={16} /> Nova meta</Button> : undefined}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <Select aria-label="Período" value={period} onChange={(e) => setPeriod(e.target.value as GoalPeriodFilter)} options={PERIOD_OPTIONS} />
        {canManage && (
          <Select
            aria-label="Filtrar por vendedor"
            value={ownerFilter}
            onChange={(e) => setOwnerFilter(e.target.value)}
            options={[{ value: '', label: 'Todos' }, { value: 'team', label: 'Equipe toda' }, ...users.map((u) => ({ value: u.id, label: u.name }))]}
          />
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Spinner size="lg" className="text-orange-500" /></div>
      ) : goals.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Trophy size={40} />}
            title="Nenhuma meta por aqui"
            description={canManage ? 'Crie a primeira meta do comercial: valor vendido, negócios fechados, novos leads ou contatos.' : 'Seu gerente ainda não definiu metas para este período.'}
            action={canManage ? { label: 'Nova meta', onClick: openNew } : undefined}
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {goals.map((g) => (
            <GoalCard key={g.id} goal={g} canManage={canManage} onEdit={() => openEdit(g)} onDelete={() => setToDelete(g)} />
          ))}
        </div>
      )}

      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? 'Editar meta' : 'Nova meta'}
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setFormOpen(false)} disabled={saving}>Cancelar</Button>
            <Button onClick={save} loading={saving}>{editing ? 'Salvar' : 'Criar meta'}</Button>
          </>
        }
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2"><Input label="Nome (opcional)" placeholder="Ex.: Meta de outubro" value={form.title} onChange={(e) => set('title', e.target.value)} /></div>
          <div>
            <Select label="O que medir" value={form.metric} onChange={(e) => set('metric', e.target.value as GoalMetric)} options={METRIC_OPTIONS} />
            <p className="mt-1 text-xs text-fg-muted">{METRICS[form.metric].hint}</p>
          </div>
          <Input
            label={METRICS[form.metric].money ? 'Meta (R$) *' : 'Meta (quantidade) *'}
            type="number" inputMode="decimal" min="0" step={METRICS[form.metric].money ? '0.01' : '1'}
            icon={METRICS[form.metric].money ? <span className="text-sm">R$</span> : undefined}
            placeholder={METRICS[form.metric].money ? '0,00' : '0'}
            className="tabular-nums"
            value={form.target} error={errors.target} onChange={(e) => set('target', e.target.value)}
          />
          <div className="sm:col-span-2 flex flex-wrap gap-2">
            {presets().map((p) => (
              <Button key={p.label} size="sm" variant="secondary" onClick={() => setForm((f) => ({ ...f, periodStart: p.start, periodEnd: p.end }))}>{p.label}</Button>
            ))}
          </div>
          <Input label="Início *" type="date" value={form.periodStart} error={errors.periodStart} onChange={(e) => set('periodStart', e.target.value)} />
          <Input label="Fim *" type="date" value={form.periodEnd} error={errors.periodEnd} onChange={(e) => set('periodEnd', e.target.value)} />
          <div className="sm:col-span-2">
            <Select label="Vendedor" value={form.ownerId} onChange={(e) => set('ownerId', e.target.value)} options={[{ value: '', label: 'Equipe toda' }, ...users.map((u) => ({ value: u.id, label: u.name }))]} />
          </div>
          <div className="sm:col-span-2"><Textarea label="Observações" rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} /></div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!toDelete}
        title="Excluir meta"
        message={`Excluir a meta "${toDelete?.title || (toDelete && METRICS[toDelete.metric].label) || ''}"? Os leads e vendas não são afetados.`}
        confirmLabel="Excluir"
        loading={deleting}
        onClose={() => setToDelete(null)}
        onConfirm={() => void confirmDelete()}
      />
    </>
  )
}
