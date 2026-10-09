import { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { useSearchParams } from 'react-router-dom'
import { Plus, Search, Archive } from 'lucide-react'
import { PageHeader } from '../../components/layout/AppLayout'
import { Button } from '../../components/ui/Button'
import { Select } from '../../components/ui/Select'
import { Table } from '../../components/ui/Table'
import { LeadDrawer } from '../../components/LeadDrawer'
import { LeadFormModal } from '../../components/LeadFormModal'
import { useCommercialData } from '../../hooks/useCommercialData'
import * as api from '../../api/commercial.api'
import { errMsg } from '../../utils/apiError'
import { cn } from '../../utils/cn'
import { formatCurrency, formatPhone, timeAgo } from '../../utils/format'
import { LEAD_SOURCES, type Lead } from '../../types'

export default function LeadsPage() {
  const { stages, users, canAssign } = useCommercialData()
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)

  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [stageId, setStageId] = useState('')
  const [ownerId, setOwnerId] = useState('')
  const [source, setSource] = useState('')
  const [archived, setArchived] = useState(false)

  const [openId, setOpenId] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)

  // /leads?open=<id> abre o painel do lead direto (usado pela Prospecção após converter um prospect).
  const [searchParams, setSearchParams] = useSearchParams()
  useEffect(() => {
    const id = searchParams.get('open')
    if (!id) return
    setOpenId(id)
    setSearchParams({}, { replace: true })
  }, [searchParams, setSearchParams])

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300)
    return () => clearTimeout(t)
  }, [search])

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      setLeads(await api.listLeads({ q: debounced, stageId, ownerId, source, archived }))
    } catch (err) {
      toast.error(errMsg(err) ?? 'Erro ao carregar os leads')
    } finally {
      setLoading(false)
    }
  }, [debounced, stageId, ownerId, source, archived])

  useEffect(() => { void load() }, [load])

  const closeDrawer = useCallback(() => setOpenId(null), [])

  const totalValue = leads.reduce((sum, l) => sum + l.value, 0)

  return (
    <>
      <PageHeader
        title={archived ? 'Leads arquivados' : 'Leads'}
        subtitle={`${leads.length} lead(s) · ${formatCurrency(totalValue)} em valor estimado`}
        action={
          <>
            <Button variant="secondary" onClick={() => setArchived((v) => !v)}>
              <Archive size={16} /> {archived ? 'Ver ativos' : 'Arquivados'}
            </Button>
            <Button onClick={() => setFormOpen(true)}><Plus size={16} /> Novo lead</Button>
          </>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar nome, contato, e-mail, telefone"
            className="w-full rounded-lg border border-border bg-surface pl-9 pr-3 py-2 text-sm text-fg placeholder:text-fg-muted focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-400"
          />
        </div>
        <Select
          aria-label="Filtrar por etapa"
          value={stageId}
          onChange={(e) => setStageId(e.target.value)}
          options={[{ value: '', label: 'Todas as etapas' }, ...stages.map((s) => ({ value: s.id, label: s.name }))]}
        />
        {canAssign && (
          <Select
            aria-label="Filtrar por responsável"
            value={ownerId}
            onChange={(e) => setOwnerId(e.target.value)}
            options={[{ value: '', label: 'Todos os responsáveis' }, { value: 'none', label: 'Sem responsável' }, ...users.map((u) => ({ value: u.id, label: u.name }))]}
          />
        )}
        <Select
          aria-label="Filtrar por origem"
          value={source}
          onChange={(e) => setSource(e.target.value)}
          options={[{ value: '', label: 'Todas as origens' }, ...LEAD_SOURCES.map((s) => ({ value: s, label: s }))]}
        />
      </div>

      <Table
        loading={loading}
        data={leads}
        keyExtractor={(l) => l.id}
        onRowClick={(l) => setOpenId(l.id)}
        emptyMessage={archived ? 'Nenhum lead arquivado' : 'Nenhum lead encontrado'}
        columns={[
          {
            key: 'name',
            header: 'Lead',
            cell: (l) => (
              <div className="min-w-[180px]">
                <p className="font-medium text-fg">{l.name}</p>
                {(l.contactName || l.phone) && (
                  <p className="text-xs text-fg-muted">{[l.contactName, l.phone && formatPhone(l.phone)].filter(Boolean).join(' · ')}</p>
                )}
              </div>
            ),
          },
          {
            key: 'stage',
            header: 'Etapa',
            cell: (l) => (
              <span
                className={cn('inline-flex px-2 py-0.5 rounded-full text-xs font-medium text-white whitespace-nowrap')}
                style={{ backgroundColor: l.stage.color }}
              >
                {l.stage.name}
              </span>
            ),
          },
          { key: 'value', header: 'Valor', cell: (l) => <span className="whitespace-nowrap">{formatCurrency(l.value)}</span> },
          { key: 'source', header: 'Origem', cell: (l) => l.source ?? '—' },
          { key: 'owner', header: 'Responsável', cell: (l) => l.owner?.name ?? '—' },
          {
            key: 'tasks',
            header: 'Tarefas',
            cell: (l) => (l.openTasks > 0 ? <span className="text-tone-amber-fg bg-tone-amber-bg rounded-full px-2 py-0.5 text-xs">{l.openTasks}</span> : '—'),
          },
          { key: 'updated', header: 'Atualizado', cell: (l) => <span className="whitespace-nowrap text-fg-muted">{timeAgo(l.updatedAt)}</span> },
        ]}
      />

      <LeadDrawer leadId={openId} stages={stages} users={users} onClose={closeDrawer} onChanged={() => void load(true)} />

      <LeadFormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        stages={stages}
        users={users}
        canAssign={canAssign}
        onSaved={() => void load(true)}
      />
    </>
  )
}
