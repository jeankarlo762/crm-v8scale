import { useCallback, useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { Check, Plus, Trash2 } from 'lucide-react'
import { PageHeader } from '../../components/layout/AppLayout'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { EmptyState } from '../../components/ui/EmptyState'
import { Input } from '../../components/ui/Input'
import { Modal } from '../../components/ui/Modal'
import { Select } from '../../components/ui/Select'
import { Spinner } from '../../components/ui/Spinner'
import { LeadDrawer } from '../../components/LeadDrawer'
import { useCommercialData } from '../../hooks/useCommercialData'
import * as api from '../../api/commercial.api'
import { errMsg } from '../../utils/apiError'
import { cn } from '../../utils/cn'
import { formatDateTime, toDateTimeInput } from '../../utils/format'
import type { Lead, Task } from '../../types'

type Status = 'open' | 'done'

function defaultDue(): string {
  const d = new Date(Date.now() + 24 * 60 * 60 * 1000)
  d.setHours(9, 0, 0, 0)
  return toDateTimeInput(d)
}

// Mesmo fuso que o backend usa no dashboard (America/Sao_Paulo), para
// "Hoje" e "Atrasadas" baterem com os números dos KPIs mesmo num PC com
// relógio em outro fuso.
const TZ = 'America/Sao_Paulo'
function dayKey(d: Date): string {
  return d.toLocaleDateString('en-CA', { timeZone: TZ })
}
function startOfToday(): number {
  return new Date(`${dayKey(new Date())}T00:00:00-03:00`).getTime()
}

export default function TasksPage() {
  const { stages, users, canAssign } = useCommercialData()
  const [status, setStatus] = useState<Status>('open')
  const [mine, setMine] = useState(false)
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [openLeadId, setOpenLeadId] = useState<string | null>(null)

  const [formOpen, setFormOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [due, setDue] = useState(defaultDue)
  const [leadId, setLeadId] = useState('')
  const [assigneeId, setAssigneeId] = useState('')
  const [leadOptions, setLeadOptions] = useState<Lead[]>([])
  const [saving, setSaving] = useState(false)

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      setTasks(await api.listTasks({ status, mine }))
    } catch (err) {
      toast.error(errMsg(err) ?? 'Erro ao carregar as tarefas')
    } finally {
      setLoading(false)
    }
  }, [status, mine])

  useEffect(() => { void load() }, [load])

  const closeDrawer = useCallback(() => setOpenLeadId(null), [])

  async function openForm() {
    setTitle('')
    setDue(defaultDue())
    setLeadId('')
    setAssigneeId('')
    setFormOpen(true)
    if (leadOptions.length === 0) {
      api.listLeads().then((l) => setLeadOptions(l.filter((x) => x.stage.kind === 'OPEN'))).catch(() => undefined)
    }
  }

  async function submit() {
    if (!title.trim() || !due) return
    setSaving(true)
    try {
      await api.createTask({
        title: title.trim(),
        dueAt: new Date(due).toISOString(),
        leadId: leadId || null,
        ...(canAssign && assigneeId && { assigneeId }),
      })
      toast.success('Tarefa criada')
      setFormOpen(false)
      await load(true)
    } catch (err) {
      toast.error(errMsg(err) ?? 'Não foi possível criar a tarefa')
    } finally {
      setSaving(false)
    }
  }

  async function toggle(task: Task) {
    try {
      await api.updateTask(task.id, { done: !task.done })
      await load(true)
    } catch (err) {
      toast.error(errMsg(err) ?? 'Não foi possível atualizar a tarefa')
    }
  }

  async function remove(task: Task) {
    try {
      await api.deleteTask(task.id)
      await load(true)
    } catch (err) {
      toast.error(errMsg(err) ?? 'Não foi possível excluir a tarefa')
    }
  }

  const groups = useMemo(() => {
    if (status === 'done') return [{ key: 'done', title: 'Concluídas', tone: 'text-fg-muted', items: tasks }]
    const today = startOfToday()
    const tomorrow = today + 24 * 60 * 60 * 1000
    const overdue = tasks.filter((t) => new Date(t.dueAt).getTime() < today)
    const todayItems = tasks.filter((t) => {
      const ts = new Date(t.dueAt).getTime()
      return ts >= today && ts < tomorrow
    })
    const upcoming = tasks.filter((t) => new Date(t.dueAt).getTime() >= tomorrow)
    return [
      { key: 'overdue', title: 'Atrasadas', tone: 'text-tone-red-fg', items: overdue },
      { key: 'today', title: 'Hoje', tone: 'text-tone-amber-fg', items: todayItems },
      { key: 'upcoming', title: 'Próximas', tone: 'text-fg-muted', items: upcoming },
    ].filter((g) => g.items.length > 0)
  }, [tasks, status])

  return (
    <>
      <PageHeader
        title="Tarefas"
        subtitle="Follow-ups e próximos passos com os leads"
        action={<Button onClick={openForm}><Plus size={16} /> Nova tarefa</Button>}
      />

      <div className="flex flex-wrap items-center gap-3 mb-5">
        <div className="inline-flex rounded-lg border border-border overflow-hidden">
          {([['open', 'Abertas'], ['done', 'Concluídas']] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setStatus(key)}
              className={cn(
                'px-4 py-1.5 text-sm font-medium transition-colors',
                status === key ? 'bg-orange-500 text-white' : 'bg-surface text-fg-muted hover:bg-surface-hover',
              )}
            >
              {label}
            </button>
          ))}
        </div>
        {canAssign && (
          <label className="inline-flex items-center gap-2 text-sm text-fg-muted cursor-pointer">
            <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} className="rounded border-border accent-orange-500" />
            Só as minhas
          </label>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><Spinner size="lg" className="text-orange-500" /></div>
      ) : groups.length === 0 ? (
        <Card>
          <EmptyState
            title={status === 'open' ? 'Nenhuma tarefa em aberto' : 'Nenhuma tarefa concluída'}
            description={status === 'open' ? 'Crie tarefas para não perder nenhum follow-up.' : undefined}
          />
        </Card>
      ) : (
        <div className="flex flex-col gap-6">
          {groups.map((g) => (
            <section key={g.key}>
              <h2 className={cn('text-xs font-semibold uppercase tracking-wide mb-2', g.tone)}>{g.title} ({g.items.length})</h2>
              <Card padding={false}>
                <ul className="divide-y divide-border">
                  {g.items.map((t) => (
                    <li key={t.id} className="flex items-center gap-3 px-4 py-3">
                      <button
                        onClick={() => toggle(t)}
                        aria-label={t.done ? 'Reabrir tarefa' : 'Concluir tarefa'}
                        className={cn(
                          'w-5 h-5 rounded border flex items-center justify-center shrink-0 transition-colors',
                          t.done ? 'bg-tone-green-solid border-tone-green-solid text-white' : 'border-border hover:border-orange-500',
                        )}
                      >
                        {t.done && <Check size={13} />}
                      </button>
                      <div className="min-w-0 flex-1">
                        <p className={cn('text-sm text-fg', t.done && 'line-through text-fg-muted')}>{t.title}</p>
                        <p className="text-xs text-fg-muted">
                          {formatDateTime(t.dueAt)}
                          {t.assignee && ` · ${t.assignee.name}`}
                          {t.lead && (
                            <>
                              {' · '}
                              <button onClick={() => setOpenLeadId(t.lead!.id)} className="text-orange-600 hover:underline">{t.lead.name}</button>
                            </>
                          )}
                        </p>
                      </div>
                      <button onClick={() => remove(t)} aria-label="Excluir tarefa" className="p-1.5 rounded-lg text-fg-muted hover:bg-tone-red-bg hover:text-tone-red-fg">
                        <Trash2 size={15} />
                      </button>
                    </li>
                  ))}
                </ul>
              </Card>
            </section>
          ))}
        </div>
      )}

      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title="Nova tarefa"
        footer={
          <>
            <Button variant="secondary" onClick={() => setFormOpen(false)} disabled={saving}>Cancelar</Button>
            <Button onClick={submit} loading={saving} disabled={!title.trim() || !due}>Criar tarefa</Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Input label="O que precisa ser feito? *" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
          <Input label="Prazo *" type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} />
          <Select
            label="Lead (opcional)"
            value={leadId}
            onChange={(e) => setLeadId(e.target.value)}
            options={[{ value: '', label: 'Sem lead vinculado' }, ...leadOptions.map((l) => ({ value: l.id, label: l.name }))]}
          />
          {canAssign && (
            <Select
              label="Responsável"
              value={assigneeId}
              onChange={(e) => setAssigneeId(e.target.value)}
              options={[{ value: '', label: 'Eu mesmo' }, ...users.map((u) => ({ value: u.id, label: u.name }))]}
            />
          )}
        </div>
      </Modal>

      <LeadDrawer leadId={openLeadId} stages={stages} users={users} onClose={closeDrawer} onChanged={() => void load(true)} />
    </>
  )
}
