import { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { ArchiveRestore, Search } from 'lucide-react'
import { Link } from 'react-router-dom'
import { PageHeader } from '../../components/layout/AppLayout'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { Table } from '../../components/ui/Table'
import * as api from '../../api/commercial.api'
import { useAuthStore } from '../../store/auth.store'
import { errMsg } from '../../utils/apiError'
import { formatCurrency, formatPhone } from '../../utils/format'
import type { Customer } from '../../types'

export default function ClientesArquivadosPage() {
  const canManage = useAuthStore((s) => s.hasRole('ADMIN', 'MANAGER'))
  const [customers, setCustomers] = useState<Customer[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [toRestore, setToRestore] = useState<Customer | null>(null)
  const [restoring, setRestoring] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300)
    return () => clearTimeout(t)
  }, [search])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setCustomers(await api.listCustomers(debounced || undefined, true))
    } catch (err) {
      toast.error(errMsg(err) ?? 'Erro ao carregar os clientes arquivados')
    } finally {
      setLoading(false)
    }
  }, [debounced])

  useEffect(() => { void load() }, [load])

  async function confirmRestore() {
    if (!toRestore) return
    setRestoring(true)
    try {
      await api.unarchiveCustomer(toRestore.id)
      toast.success('Cliente desarquivado')
      setToRestore(null)
      await load()
    } catch (err) {
      toast.error(errMsg(err) ?? 'Não foi possível desarquivar')
    } finally {
      setRestoring(false)
    }
  }

  return (
    <>
      <PageHeader
        title="Clientes arquivados"
        subtitle={`${customers.length} cliente(s) arquivado(s)`}
        action={<Link to="/clientes" className="text-sm text-orange-600 dark:text-orange-400 hover:underline">← Voltar para Clientes</Link>}
      />

      <div className="relative max-w-sm mb-5">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar nome, contato, e-mail, telefone"
          className="w-full rounded-lg border border-border bg-surface pl-9 pr-3 py-2 text-sm text-fg placeholder:text-fg-muted focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-400"
        />
      </div>

      <Table
        loading={loading}
        data={customers}
        keyExtractor={(c) => c.id}
        emptyMessage="Nenhum cliente arquivado. Para arquivar, abra o cliente em Clientes e use o botão Arquivar."
        columns={[
          {
            key: 'name',
            header: 'Cliente',
            cell: (c) => (
              <div className="min-w-[180px]">
                <p className="font-medium text-fg flex items-center gap-2">{c.name}{!c.active && <Badge label="Inativo" variant="gray" />}</p>
                {c.contactName && <p className="text-xs text-fg-muted">{c.contactName}</p>}
              </div>
            ),
          },
          { key: 'phone', header: 'Telefone', cell: (c) => (c.phone ? formatPhone(c.phone) : '—') },
          { key: 'email', header: 'E-mail', cell: (c) => c.email ?? '—' },
          { key: 'mrr', header: 'Última mensalidade', cell: (c) => <span className="whitespace-nowrap text-fg-muted">{formatCurrency(c.mrrValue)}</span> },
          { key: 'owner', header: 'Vendedor', cell: (c) => c.lead.owner?.name ?? '—' },
          { key: 'since', header: 'Cliente desde', cell: (c) => <span className="whitespace-nowrap text-fg-muted">{new Date(c.createdAt).toLocaleDateString('pt-BR')}</span> },
          { key: 'archived', header: 'Arquivado em', cell: (c) => <span className="whitespace-nowrap">{c.archivedAt ? new Date(c.archivedAt).toLocaleDateString('pt-BR') : '—'}</span> },
          { key: 'reason', header: 'Motivo', cell: (c) => <span className="text-fg-muted">{c.archiveReason ?? '—'}</span> },
          ...(canManage
            ? [{
                key: 'actions',
                header: '',
                cell: (c: Customer) => (
                  <Button size="sm" variant="secondary" onClick={() => setToRestore(c)}>
                    <ArchiveRestore size={14} className="mr-1.5" />Desarquivar
                  </Button>
                ),
              }]
            : []),
        ]}
      />

      <ConfirmDialog
        open={!!toRestore}
        title="Desarquivar cliente"
        message={`Desarquivar "${toRestore?.name ?? ''}"? Ele volta para a lista de Clientes${toRestore?.churnedAt && toRestore.archivedAt && toRestore.churnedAt === toRestore.archivedAt ? ' e é reativado (volta ao MRR)' : ' (continua inativo, pois já havia cancelado antes de ser arquivado)'}.`}
        confirmLabel="Desarquivar"
        loading={restoring}
        onClose={() => setToRestore(null)}
        onConfirm={() => void confirmRestore()}
      />
    </>
  )
}
