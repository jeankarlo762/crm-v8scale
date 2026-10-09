import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import toast from 'react-hot-toast'
import {
  X, Pencil, Archive, ArchiveRestore, Trash2, Phone, Mail, MessageCircle, Calendar, StickyNote,
  ArrowRightLeft, Plus, Check, MapPin, User as UserIcon, UserCog,
} from 'lucide-react'
import { Button } from './ui/Button'
import { Select } from './ui/Select'
import { Textarea } from './ui/Textarea'
import { Input } from './ui/Input'
import { Spinner } from './ui/Spinner'
import { ConfirmDialog } from './ui/ConfirmDialog'
import { LeadFormModal } from './LeadFormModal'
import { LostReasonModal } from './LostReasonModal'
import * as api from '../api/commercial.api'
import { useAuthStore } from '../store/auth.store'
import { errMsg } from '../utils/apiError'
import { cn } from '../utils/cn'
import { ownerOptions } from '../utils/owners'
import {
  daysSince, formatCurrency, formatDateOnly, formatDateTime, formatPhone, timeAgo, toDateTimeInput, whatsappLink,
} from '../utils/format'
import { ACTIVITY_LABELS, type ActivityType, type LoggableActivityType, type LeadDetail, type Stage, type Task, type UserRef } from '../types'

const ACTIVITY_ICONS: Record<ActivityType, typeof Phone> = {
  NOTE: StickyNote,
  CALL: Phone,
  WHATSAPP: MessageCircle,
  EMAIL: Mail,
  MEETING: Calendar,
  STAGE_CHANGE: ArrowRightLeft,
  OWNER_CHANGE: UserCog,
}

const LOGGABLE: LoggableActivityType[] = ['NOTE', 'CALL', 'WHATSAPP', 'EMAIL', 'MEETING']

function isOverdue(task: Task): boolean {
  return !task.done && new Date(task.dueAt).getTime() < Date.now()
}

function defaultDue(): string {
  const d = new Date(Date.now() + 24 * 60 * 60 * 1000)
  d.setHours(9, 0, 0, 0)
  return toDateTimeInput(d)
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-fg-muted">{label}</dt>
      <dd className="text-sm text-fg mt-0.5 break-words">{children || <span className="text-fg-muted">—</span>}</dd>
    </div>
  )
}

interface Props {
  leadId: string | null
  stages: Stage[]
  users: UserRef[]
  onClose: () => void
  /** Chamado após qualquer alteração, para a tela de origem recarregar a lista. */
  onChanged: () => void
}

export function LeadDrawer({ leadId, stages, users, onClose, onChanged }: Props) {
  const hasRole = useAuthStore((s) => s.hasRole)
  const canAssign = hasRole('ADMIN', 'MANAGER')

  const [lead, setLead] = useState<LeadDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [tab, setTab] = useState<'timeline' | 'tasks'>('timeline')

  const [editOpen, setEditOpen] = useState(false)
  const [lostTarget, setLostTarget] = useState<Stage | null>(null)
  const [changingStage, setChangingStage] = useState(false)
  const [changingOwner, setChangingOwner] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const [actType, setActType] = useState<LoggableActivityType>('NOTE')
  const [actText, setActText] = useState('')
  const [savingAct, setSavingAct] = useState(false)

  const [taskTitle, setTaskTitle] = useState('')
  const [taskDue, setTaskDue] = useState(defaultDue)
  const [savingTask, setSavingTask] = useState(false)

  // O pai costuma passar onClose inline (nova função a cada render); guardar em ref
  // evita recarregar o lead em loop.
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  const load = useCallback(async () => {
    if (!leadId) return
    try {
      setLead(await api.getLead(leadId))
    } catch (err) {
      toast.error(errMsg(err) ?? 'Não foi possível carregar o lead')
      onCloseRef.current()
    }
  }, [leadId])

  useEffect(() => {
    setLead(null)
    setTab('timeline')
    setActText('')
    setTaskTitle('')
    if (!leadId) return
    setLoading(true)
    load().finally(() => setLoading(false))
  }, [leadId, load])

  if (!leadId) return null

  async function refresh() {
    await load()
    onChanged()
  }

  async function changeStage(stage: Stage, lostReason?: string) {
    if (!lead) return
    setChangingStage(true)
    try {
      await api.changeLeadStage(lead.id, stage.id, lostReason)
      setLostTarget(null)
      toast.success(stage.kind === 'WON' ? 'Lead ganho — cliente criado!' : 'Etapa atualizada')
      await refresh()
    } catch (err) {
      toast.error(errMsg(err) ?? 'Não foi possível mudar a etapa')
    } finally {
      setChangingStage(false)
    }
  }

  async function changeOwner(ownerId: string) {
    if (!lead || (lead.ownerId ?? '') === ownerId) return
    setChangingOwner(true)
    try {
      await api.changeLeadOwner(lead.id, ownerId || null)
      toast.success(ownerId ? 'Responsável atualizado' : 'Lead ficou sem responsável')
      await refresh()
    } catch (err) {
      toast.error(errMsg(err) ?? 'Não foi possível trocar o responsável')
    } finally {
      setChangingOwner(false)
    }
  }

  function handleStageSelect(stageId: string) {
    const target = stages.find((s) => s.id === stageId)
    if (!target || !lead || target.id === lead.stageId) return
    if (target.kind === 'LOST') setLostTarget(target)
    else void changeStage(target)
  }

  async function toggleArchive() {
    if (!lead) return
    try {
      await api.updateLead(lead.id, { archived: !lead.archived })
      toast.success(lead.archived ? 'Lead restaurado' : 'Lead arquivado')
      onChanged()
      if (!lead.archived) onClose()
      else await load()
    } catch (err) {
      toast.error(errMsg(err) ?? 'Não foi possível arquivar')
    }
  }

  async function handleDelete() {
    if (!lead) return
    setDeleting(true)
    try {
      await api.deleteLead(lead.id)
      toast.success('Lead excluído')
      setDeleteOpen(false)
      onChanged()
      onClose()
    } catch (err) {
      toast.error(errMsg(err) ?? 'Não foi possível excluir')
    } finally {
      setDeleting(false)
    }
  }

  async function submitActivity() {
    if (!lead || !actText.trim()) return
    setSavingAct(true)
    try {
      await api.addActivity(lead.id, actType, actText.trim())
      setActText('')
      await refresh()
    } catch (err) {
      toast.error(errMsg(err) ?? 'Não foi possível registrar')
    } finally {
      setSavingAct(false)
    }
  }

  async function submitTask() {
    if (!lead || !taskTitle.trim() || !taskDue) return
    setSavingTask(true)
    try {
      await api.createTask({ title: taskTitle.trim(), dueAt: new Date(taskDue).toISOString(), leadId: lead.id })
      setTaskTitle('')
      setTaskDue(defaultDue())
      await refresh()
    } catch (err) {
      toast.error(errMsg(err) ?? 'Não foi possível criar a tarefa')
    } finally {
      setSavingTask(false)
    }
  }

  async function toggleTask(task: Task) {
    try {
      await api.updateTask(task.id, { done: !task.done })
      await refresh()
    } catch (err) {
      toast.error(errMsg(err) ?? 'Não foi possível atualizar a tarefa')
    }
  }

  async function removeTask(task: Task) {
    try {
      await api.deleteTask(task.id)
      await refresh()
    } catch (err) {
      toast.error(errMsg(err) ?? 'Não foi possível excluir a tarefa')
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-overlay/40" onClick={onClose} aria-hidden />
      <aside
        className="fixed top-0 right-0 z-40 h-full w-full max-w-xl bg-surface border-l border-border shadow-2xl flex flex-col"
        role="dialog"
        aria-label="Detalhes do lead"
      >
        {loading || !lead ? (
          <div className="flex-1 flex items-center justify-center">
            <Spinner size="lg" className="text-orange-500" />
          </div>
        ) : (
          <>
            {/* Cabeçalho */}
            <div className="px-6 py-4 border-b border-border shrink-0">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-lg font-semibold text-fg truncate">{lead.name}</h2>
                  <div className="flex flex-wrap items-center gap-2 mt-1">
                    <span
                      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium text-white"
                      style={{ backgroundColor: lead.stage.color }}
                    >
                      {lead.stage.name}
                    </span>
                    {lead.archived && <span className="text-xs text-fg-muted">arquivado</span>}
                    <span className="text-sm font-semibold text-fg">{formatCurrency(lead.value)}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={() => setEditOpen(true)} aria-label="Editar" title="Editar" className="p-2 rounded-lg text-fg-muted hover:bg-surface-hover hover:text-fg">
                    <Pencil size={16} />
                  </button>
                  <button onClick={toggleArchive} aria-label={lead.archived ? 'Restaurar' : 'Arquivar'} title={lead.archived ? 'Restaurar' : 'Arquivar'} className="p-2 rounded-lg text-fg-muted hover:bg-surface-hover hover:text-fg">
                    {lead.archived ? <ArchiveRestore size={16} /> : <Archive size={16} />}
                  </button>
                  {canAssign && lead.stage.kind !== 'WON' && (
                    <button onClick={() => setDeleteOpen(true)} aria-label="Excluir" title="Excluir" className="p-2 rounded-lg text-fg-muted hover:bg-tone-red-bg hover:text-tone-red-fg">
                      <Trash2 size={16} />
                    </button>
                  )}
                  <button onClick={onClose} aria-label="Fechar" className="p-2 rounded-lg text-fg-muted hover:bg-surface-hover hover:text-fg">
                    <X size={18} />
                  </button>
                </div>
              </div>

              {/* Ações rápidas de contato */}
              {(lead.phone || lead.email) && (
                <div className="flex flex-wrap gap-2 mt-3">
                  {lead.phone && (
                    <>
                      <a href={`tel:${lead.phone}`} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-border text-fg hover:bg-surface-hover">
                        <Phone size={13} /> {formatPhone(lead.phone)}
                      </a>
                      <a href={whatsappLink(lead.phone)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-tone-green-bg text-tone-green-fg hover:brightness-95">
                        <MessageCircle size={13} /> WhatsApp
                      </a>
                    </>
                  )}
                  {lead.email && (
                    <a href={`mailto:${lead.email}`} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-border text-fg hover:bg-surface-hover">
                      <Mail size={13} /> {lead.email}
                    </a>
                  )}
                </div>
              )}
            </div>

            <div className="flex-1 overflow-y-auto">
              {/* Etapa */}
              <div className="px-6 py-4 border-b border-border">
                <Select
                  label="Etapa do funil"
                  value={lead.stageId}
                  disabled={changingStage}
                  onChange={(e) => handleStageSelect(e.target.value)}
                  options={stages.map((s) => ({ value: s.id, label: s.name }))}
                />
                {lead.stage.kind === 'LOST' && lead.lostReason && (
                  <p className="mt-2 text-xs text-tone-red-fg bg-tone-red-bg rounded-lg px-3 py-2">Motivo da perda: {lead.lostReason}</p>
                )}
                <p className="mt-2 text-xs text-fg-muted">Nesta etapa há {daysSince(lead.stageChangedAt)} dia(s).</p>
                {canAssign && (
                  <div className="mt-3">
                    <Select
                      label="Responsável"
                      value={lead.ownerId ?? ''}
                      disabled={changingOwner}
                      onChange={(e) => void changeOwner(e.target.value)}
                      options={ownerOptions(users, lead.owner)}
                    />
                    <p className="mt-1 text-xs text-fg-muted">Ao trocar, as tarefas em aberto do responsável anterior passam para o novo.</p>
                  </div>
                )}
              </div>

              {/* Dados */}
              <dl className="px-6 py-4 grid grid-cols-2 gap-x-4 gap-y-3 border-b border-border">
                <Field label="Contato">{lead.contactName}</Field>
                <Field label="Responsável">
                  {lead.owner && (
                    <span className="inline-flex items-center gap-1"><UserIcon size={12} className="text-fg-muted" />{lead.owner.name}</span>
                  )}
                </Field>
                <Field label="CPF / CNPJ">{lead.document}</Field>
                <Field label="Origem">{lead.source}</Field>
                <Field label="Cidade / UF">
                  {(lead.city || lead.state) && (
                    <span className="inline-flex items-center gap-1"><MapPin size={12} className="text-fg-muted" />{[lead.city, lead.state].filter(Boolean).join(' / ')}</span>
                  )}
                </Field>
                <Field label="Segmento">{lead.segment}</Field>
                <Field label="Previsão de fechamento">{lead.expectedCloseAt && formatDateOnly(lead.expectedCloseAt)}</Field>
                <Field label="Criado">{timeAgo(lead.createdAt)}</Field>
                {lead.notes && (
                  <div className="col-span-2">
                    <dt className="text-xs text-fg-muted">Observações</dt>
                    <dd className="text-sm text-fg mt-0.5 whitespace-pre-wrap">{lead.notes}</dd>
                  </div>
                )}
              </dl>

              {/* Abas */}
              <div className="px-6 pt-4">
                <div className="flex gap-1 border-b border-border">
                  {([['timeline', 'Histórico'], ['tasks', `Tarefas${lead.openTasks ? ` (${lead.openTasks})` : ''}`]] as const).map(([key, label]) => (
                    <button
                      key={key}
                      onClick={() => setTab(key)}
                      className={cn(
                        'px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
                        tab === key ? 'border-orange-500 text-orange-600' : 'border-transparent text-fg-muted hover:text-fg',
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="px-6 py-4">
                {tab === 'timeline' ? (
                  <div className="flex flex-col gap-4">
                    <div className="rounded-xl border border-border p-3 flex flex-col gap-2">
                      <div className="flex gap-1 flex-wrap">
                        {LOGGABLE.map((t) => {
                          const Icon = ACTIVITY_ICONS[t]
                          return (
                            <button
                              key={t}
                              type="button"
                              onClick={() => setActType(t)}
                              className={cn(
                                'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-colors',
                                actType === t ? 'bg-orange-500 text-white' : 'bg-surface-hover text-fg-muted hover:text-fg',
                              )}
                            >
                              <Icon size={12} /> {ACTIVITY_LABELS[t]}
                            </button>
                          )
                        })}
                      </div>
                      <Textarea
                        rows={2}
                        value={actText}
                        onChange={(e) => setActText(e.target.value)}
                        placeholder="O que aconteceu? (ex.: conversei com o dono, pediu proposta até sexta)"
                      />
                      <div className="flex justify-end">
                        <Button size="sm" onClick={submitActivity} loading={savingAct} disabled={!actText.trim()}>Registrar</Button>
                      </div>
                    </div>

                    <ol className="flex flex-col gap-3">
                      {lead.activities.map((a) => {
                        const Icon = ACTIVITY_ICONS[a.type]
                        return (
                          <li key={a.id} className="flex gap-3">
                            <div className={cn(
                              'w-7 h-7 rounded-full flex items-center justify-center shrink-0',
                              a.type === 'STAGE_CHANGE' || a.type === 'OWNER_CHANGE' ? 'bg-tone-indigo-bg text-tone-indigo-fg' : 'bg-primary-soft text-primary-soft-fg',
                            )}>
                              <Icon size={13} />
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-sm text-fg whitespace-pre-wrap break-words">{a.content}</p>
                              <p className="text-xs text-fg-muted mt-0.5">
                                {ACTIVITY_LABELS[a.type]} · {a.user?.name ?? 'Sistema'} · {formatDateTime(a.createdAt)}
                              </p>
                            </div>
                          </li>
                        )
                      })}
                    </ol>
                  </div>
                ) : (
                  <div className="flex flex-col gap-4">
                    <div className="rounded-xl border border-border p-3 grid grid-cols-1 sm:grid-cols-[1fr_auto_auto] gap-2 items-end">
                      <Input label="Nova tarefa" value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} placeholder="Ex.: ligar para confirmar proposta" />
                      <Input label="Prazo" type="datetime-local" value={taskDue} onChange={(e) => setTaskDue(e.target.value)} />
                      <Button onClick={submitTask} loading={savingTask} disabled={!taskTitle.trim() || !taskDue}>
                        <Plus size={14} /> Adicionar
                      </Button>
                    </div>

                    {lead.tasks.length === 0 ? (
                      <p className="text-sm text-fg-muted text-center py-4">Nenhuma tarefa neste lead.</p>
                    ) : (
                      <ul className="flex flex-col gap-2">
                        {lead.tasks.map((t) => {
                          const overdue = isOverdue(t)
                          return (
                            <li key={t.id} className="flex items-center gap-3 rounded-lg border border-border px-3 py-2">
                              <button
                                onClick={() => toggleTask(t)}
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
                                <p className={cn('text-xs', overdue ? 'text-tone-red-fg font-medium' : 'text-fg-muted')}>
                                  {formatDateTime(t.dueAt)}{overdue && ' · atrasada'}{t.assignee && ` · ${t.assignee.name}`}
                                </p>
                              </div>
                              <button onClick={() => removeTask(t)} aria-label="Excluir tarefa" className="p-1.5 rounded-lg text-fg-muted hover:bg-tone-red-bg hover:text-tone-red-fg">
                                <Trash2 size={14} />
                              </button>
                            </li>
                          )
                        })}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </aside>

      {lead && (
        <>
          <LeadFormModal
            open={editOpen}
            onClose={() => setEditOpen(false)}
            lead={lead}
            stages={stages}
            users={users}
            canAssign={canAssign}
            onSaved={() => void refresh()}
          />
          <LostReasonModal
            open={!!lostTarget}
            leadName={lead.name}
            loading={changingStage}
            onClose={() => setLostTarget(null)}
            onConfirm={(reason) => lostTarget && void changeStage(lostTarget, reason)}
          />
          <ConfirmDialog
            open={deleteOpen}
            onClose={() => setDeleteOpen(false)}
            onConfirm={handleDelete}
            loading={deleting}
            title="Excluir lead"
            message={`Excluir "${lead.name}" e todo o histórico e tarefas dele? Essa ação não pode ser desfeita. Leads que já viraram cliente não podem ser excluídos. Para só tirar do funil, use Arquivar.`}
            confirmLabel="Excluir"
          />
        </>
      )}
    </>
  )
}
