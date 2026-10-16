import { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { Archive, FileSignature, Search } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Badge } from '../../components/ui/Badge'
import { useAuthStore } from '../../store/auth.store'
import { PageHeader } from '../../components/layout/AppLayout'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Modal } from '../../components/ui/Modal'
import { Table } from '../../components/ui/Table'
import { Textarea } from '../../components/ui/Textarea'
import * as api from '../../api/commercial.api'
import { errMsg } from '../../utils/apiError'
import { formatCurrency, formatPhone } from '../../utils/format'
import type { Customer } from '../../types'

export default function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')

  const [editing, setEditing] = useState<Customer | null>(null)
  const [form, setForm] = useState({ name: '', contactName: '', email: '', phone: '', document: '', mrrValue: '0', setupFee: '0', active: true, notes: '' })
  const [saving, setSaving] = useState(false)
  const [archiving, setArchiving] = useState(false)
  const [archiveReason, setArchiveReason] = useState('')
  const [archiveBusy, setArchiveBusy] = useState(false)
  const canManage = useAuthStore((s) => s.hasRole('ADMIN', 'MANAGER'))
  const navigate = useNavigate()

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300)
    return () => clearTimeout(t)
  }, [search])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setCustomers(await api.listCustomers(debounced || undefined))
    } catch (err) {
      toast.error(errMsg(err) ?? 'Erro ao carregar os clientes')
    } finally {
      setLoading(false)
    }
  }, [debounced])

  useEffect(() => { void load() }, [load])

  function openEdit(c: Customer) {
    setEditing(c)
    setForm({
      name: c.name,
      contactName: c.contactName ?? '',
      email: c.email ?? '',
      phone: c.phone ?? '',
      document: c.document ?? '',
      mrrValue: String(c.mrrValue),
      setupFee: String(c.setupFee),
      active: c.active,
      notes: c.notes ?? '',
    })
  }

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  async function save() {
    if (!editing || !form.name.trim()) return
    const mrr = Number(form.mrrValue)
    const setupFee = Number(form.setupFee)
    if (!Number.isFinite(mrr) || mrr < 0 || !Number.isFinite(setupFee) || setupFee < 0) {
      toast.error('Valor inválido')
      return
    }
    setSaving(true)
    try {
      await api.updateCustomer(editing.id, {
        name: form.name.trim(),
        contactName: form.contactName.trim() || null,
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        document: form.document.trim() || null,
        mrrValue: mrr,
        setupFee,
        ...(canManage && form.active !== editing.active && { active: form.active }),
        notes: form.notes.trim() || null,
      })
      toast.success('Cliente atualizado')
      setEditing(null)
      await load()
    } catch (err) {
      toast.error(errMsg(err) ?? 'Não foi possível salvar')
    } finally {
      setSaving(false)
    }
  }

  async function confirmArchive() {
    if (!editing) return
    setArchiveBusy(true)
    try {
      await api.archiveCustomer(editing.id, archiveReason)
      toast.success('Cliente arquivado')
      setArchiving(false)
      setEditing(null)
      await load()
    } catch (err) {
      toast.error(errMsg(err) ?? 'Não foi possível arquivar')
    } finally {
      setArchiveBusy(false)
    }
  }

  const mrrTotal = customers.filter((c) => c.active).reduce((sum, c) => sum + c.mrrValue, 0)

  return (
    <>
      <PageHeader
        title="Clientes"
        subtitle={`${customers.filter((c) => c.active).length} cliente(s) ativos · ${formatCurrency(mrrTotal)} de receita recorrente mensal`}
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
        onRowClick={openEdit}
        emptyMessage="Nenhum cliente ainda — eles aparecem aqui quando um lead é marcado como ganho."
        columns={[
          {
            key: 'name',
            header: 'Cliente',
            cell: (c) => (
              <div className="min-w-[180px]">
                <p className="font-medium text-fg flex items-center gap-2">{c.name}{!c.active && <Badge label="Cancelado" variant="red" />}</p>
                {c.contactName && <p className="text-xs text-fg-muted">{c.contactName}</p>}
              </div>
            ),
          },
          { key: 'phone', header: 'Telefone', cell: (c) => (c.phone ? formatPhone(c.phone) : '—') },
          { key: 'email', header: 'E-mail', cell: (c) => c.email ?? '—' },
          { key: 'mrr', header: 'Mensalidade', cell: (c) => <span className={`whitespace-nowrap${c.active ? '' : ' text-fg-muted line-through'}`}>{formatCurrency(c.mrrValue)}</span> },
          { key: 'owner', header: 'Vendedor', cell: (c) => c.lead.owner?.name ?? '—' },
          { key: 'since', header: 'Cliente desde', cell: (c) => <span className="whitespace-nowrap text-fg-muted">{new Date(c.createdAt).toLocaleDateString('pt-BR')}</span> },
        ]}
      />

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title="Editar cliente"
        size="lg"
        footer={
          <>
            {canManage && (
              <Button variant="secondary" className="mr-auto" onClick={() => { setArchiveReason(''); setArchiving(true) }} disabled={saving}>
                <Archive size={15} className="mr-1.5" />Arquivar
              </Button>
            )}
            {canManage && editing && (
              <Button variant="secondary" onClick={() => navigate(`/contratos?cliente=${editing.id}`)} disabled={saving}>
                <FileSignature size={15} className="mr-1.5" />Gerar contrato
              </Button>
            )}
            <Button variant="secondary" onClick={() => setEditing(null)} disabled={saving}>Cancelar</Button>
            <Button onClick={save} loading={saving} disabled={!form.name.trim()}>Salvar</Button>
          </>
        }
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2"><Input label="Nome *" value={form.name} onChange={(e) => set('name', e.target.value)} /></div>
          <Input label="Contato" value={form.contactName} onChange={(e) => set('contactName', e.target.value)} />
          <Input label="E-mail" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} />
          <Input label="Telefone" value={form.phone} onChange={(e) => set('phone', e.target.value)} />
          <Input label="CPF / CNPJ" value={form.document} onChange={(e) => set('document', e.target.value)} />
          <Input label="Mensalidade (R$)" type="number" step="0.01" min="0" value={form.mrrValue} onChange={(e) => set('mrrValue', e.target.value)} />
          <Input label="Implantação (R$, cobrada uma vez)" type="number" step="0.01" min="0" value={form.setupFee} onChange={(e) => set('setupFee', e.target.value)} />
          {canManage && (
            <div className="sm:col-span-2">
              <label className="flex items-center gap-2 text-sm text-fg cursor-pointer select-none">
                <input type="checkbox" checked={form.active} onChange={(e) => set('active', e.target.checked)} className="w-4 h-4 rounded accent-orange-500" />
                Cliente ativo (desmarque quando cancelar: sai da receita recorrente e conta como cancelamento nos relatórios)
              </label>
            </div>
          )}
          <div className="sm:col-span-2"><Textarea label="Observações" rows={3} value={form.notes} onChange={(e) => set('notes', e.target.value)} /></div>
        </div>
      </Modal>

      <Modal
        open={archiving}
        onClose={() => setArchiving(false)}
        title="Arquivar cliente"
        footer={
          <>
            <Button variant="secondary" onClick={() => setArchiving(false)} disabled={archiveBusy}>Cancelar</Button>
            <Button onClick={() => void confirmArchive()} loading={archiveBusy}>Arquivar</Button>
          </>
        }
      >
        <p className="text-sm text-fg mb-3">
          <strong>{editing?.name}</strong> sai desta lista e vai para <em>Clientes arquivados</em>. O cliente é inativado
          {editing?.active ? ' (sai da receita recorrente e conta como cancelamento nos relatórios)' : ''}. Dá para desarquivar depois.
        </p>
        <Textarea label="Motivo (opcional)" rows={2} placeholder="Ex.: contrato encerrado, cadastro duplicado" value={archiveReason} onChange={(e) => setArchiveReason(e.target.value)} />
      </Modal>
    </>
  )
}
