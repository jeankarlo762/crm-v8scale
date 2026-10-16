import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import {
  FileText, Plus, Download, Send, Copy, Pencil, Trash2, CheckCircle2, Ban, Search, ExternalLink, FileSignature,
} from 'lucide-react'
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
import * as contractsApi from '../../api/contracts.api'
import type { Contract, ContractInput, ContractStatus } from '../../api/contracts.api'
import * as commercialApi from '../../api/commercial.api'
import type { Customer } from '../../types'
import { errMsg } from '../../utils/apiError'
import { cn } from '../../utils/cn'
import { formatCurrency } from '../../utils/format'

const STATUS: Record<ContractStatus, { label: string; cls: string }> = {
  DRAFT: { label: 'Rascunho', cls: 'bg-tone-gray-bg text-tone-gray-fg' },
  SENT: { label: 'Aguardando assinatura', cls: 'bg-tone-blue-bg text-tone-blue-fg' },
  SIGNED: { label: 'Assinado', cls: 'bg-tone-green-bg text-tone-green-fg' },
  CANCELLED: { label: 'Cancelado', cls: 'bg-tone-red-bg text-tone-red-fg' },
}

const FILTERS: { value: '' | ContractStatus; label: string }[] = [
  { value: '', label: 'Todos' },
  { value: 'DRAFT', label: 'Rascunhos' },
  { value: 'SENT', label: 'Aguardando' },
  { value: 'SIGNED', label: 'Assinados' },
  { value: 'CANCELLED', label: 'Cancelados' },
]

interface FormState {
  customerId: string
  clientName: string
  clientDocument: string
  clientEmail: string
  clientPhone: string
  clientAddress: string
  title: string
  serviceObject: string
  monthlyValue: string
  setupFee: string
  paymentDay: string
  startDate: string
  durationMonths: string
  bodyText: string
  notes: string
}

const EMPTY: FormState = {
  customerId: '', clientName: '', clientDocument: '', clientEmail: '', clientPhone: '', clientAddress: '',
  title: 'Contrato de Prestação de Serviços', serviceObject: '', monthlyValue: '0', setupFee: '0',
  paymentDay: '10', startDate: '', durationMonths: '12', bodyText: '', notes: '',
}

function fromCustomer(c: Customer, base: FormState): FormState {
  return {
    ...base,
    customerId: c.id,
    clientName: c.name,
    clientDocument: c.document ?? '',
    clientEmail: c.email ?? '',
    clientPhone: c.phone ?? '',
    monthlyValue: String(c.mrrValue),
    setupFee: String(c.setupFee),
  }
}

function fromContract(c: Contract): FormState {
  return {
    customerId: c.customerId ?? '',
    clientName: c.clientName,
    clientDocument: c.clientDocument ?? '',
    clientEmail: c.clientEmail ?? '',
    clientPhone: c.clientPhone ?? '',
    clientAddress: c.clientAddress ?? '',
    title: c.title,
    serviceObject: c.serviceObject ?? '',
    monthlyValue: String(c.monthlyValue),
    setupFee: String(c.setupFee),
    paymentDay: c.paymentDay ? String(c.paymentDay) : '',
    startDate: c.startDate ? c.startDate.slice(0, 10) : '',
    durationMonths: c.durationMonths ? String(c.durationMonths) : '',
    bodyText: c.bodyText ?? '',
    notes: c.notes ?? '',
  }
}

const optInt = (v: string) => (v.trim() ? Number(v) : null)

function toInput(f: FormState): ContractInput {
  return {
    customerId: f.customerId || null,
    clientName: f.clientName.trim(),
    clientDocument: f.clientDocument.trim() || null,
    clientEmail: f.clientEmail.trim() || null,
    clientPhone: f.clientPhone.trim() || null,
    clientAddress: f.clientAddress.trim() || null,
    title: f.title.trim() || undefined,
    serviceObject: f.serviceObject.trim() || null,
    monthlyValue: Number(f.monthlyValue) || 0,
    setupFee: Number(f.setupFee) || 0,
    paymentDay: optInt(f.paymentDay),
    startDate: f.startDate || null,
    durationMonths: optInt(f.durationMonths),
    bodyText: f.bodyText.trim() || null,
    notes: f.notes.trim() || null,
  }
}

const fmtDay = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'UTC' }) : null)
const fmtWhen = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : null)

type Confirm = { kind: 'send' | 'signed' | 'cancel' | 'delete'; contract: Contract }

const CONFIRM_TEXT: Record<Confirm['kind'], { title: string; label: string; message: (c: Contract) => string }> = {
  send: {
    title: 'Enviar para assinatura',
    label: 'Enviar',
    message: (c) => `O ZapSign envia o link de assinatura para ${[c.clientEmail, c.clientPhone].filter(Boolean).join(' e ')}. Depois do envio o contrato não pode mais ser editado.`,
  },
  signed: {
    title: 'Dar baixa manual',
    label: 'Marcar como assinado',
    message: (c) => `Marcar o contrato de ${c.clientName} como assinado? Use quando a assinatura foi feita fora do ZapSign (em papel, por exemplo).`,
  },
  cancel: {
    title: 'Cancelar contrato',
    label: 'Cancelar contrato',
    message: (c) => `Cancelar o contrato de ${c.clientName}? Ele fica no histórico como cancelado. Se já foi enviado, cancele também o documento no painel do ZapSign.`,
  },
  delete: {
    title: 'Excluir rascunho',
    label: 'Excluir',
    message: (c) => `Excluir o rascunho de ${c.clientName}? Essa ação não pode ser desfeita.`,
  },
}

export default function ContratosPage() {
  const [params, setParams] = useSearchParams()
  const [contracts, setContracts] = useState<Contract[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState<'' | ContractStatus>('')
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')

  const [formOpen, setFormOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY)
  const [saving, setSaving] = useState(false)
  const [loadingTemplate, setLoadingTemplate] = useState(false)

  const [busyId, setBusyId] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<Confirm | null>(null)
  const [confirmBusy, setConfirmBusy] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300)
    return () => clearTimeout(t)
  }, [search])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setContracts(await contractsApi.listContracts({ ...(status && { status }), ...(debounced && { q: debounced }) }))
    } catch (err) {
      toast.error(errMsg(err) ?? 'Erro ao carregar os contratos')
    } finally {
      setLoading(false)
    }
  }, [status, debounced])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    commercialApi.listCustomers().then(setCustomers).catch(() => undefined)
  }, [])

  // /contratos?cliente=<id>: abre um contrato novo já preenchido com o cliente (atalho da tela Clientes).
  useEffect(() => {
    const id = params.get('cliente')
    if (!id || customers.length === 0) return
    const c = customers.find((x) => x.id === id)
    if (c) { setEditingId(null); setForm(fromCustomer(c, EMPTY)); setFormOpen(true) }
    params.delete('cliente')
    setParams(params, { replace: true })
  }, [params, setParams, customers])

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  function openNew() {
    setEditingId(null); setForm(EMPTY); setFormOpen(true)
  }

  function openEdit(c: Contract) {
    setEditingId(c.id); setForm(fromContract(c)); setFormOpen(true)
  }

  function pickCustomer(id: string) {
    const c = customers.find((x) => x.id === id)
    setForm((f) => (c ? fromCustomer(c, f) : { ...f, customerId: '' }))
  }

  async function loadTemplate() {
    setLoadingTemplate(true)
    try {
      const input = toInput(form)
      const tpl = await contractsApi.getTemplate({
        monthlyValue: input.monthlyValue,
        setupFee: input.setupFee,
        ...(input.paymentDay && { paymentDay: input.paymentDay }),
        ...(input.durationMonths && { durationMonths: input.durationMonths }),
        ...(input.startDate && { startDate: input.startDate }),
      })
      setForm((f) => ({ ...f, bodyText: tpl.bodyText }))
    } catch (err) {
      toast.error(errMsg(err) ?? 'Não foi possível carregar o modelo')
    } finally {
      setLoadingTemplate(false)
    }
  }

  async function save() {
    if (!form.clientName.trim()) { toast.error('Informe o nome do contratante'); return }
    const monthly = Number(form.monthlyValue)
    const setup = Number(form.setupFee)
    if (!Number.isFinite(monthly) || monthly < 0 || !Number.isFinite(setup) || setup < 0) { toast.error('Valor inválido'); return }
    setSaving(true)
    try {
      if (editingId) {
        await contractsApi.updateContract(editingId, toInput(form))
        toast.success('Contrato atualizado')
      } else {
        await contractsApi.createContract(toInput(form))
        toast.success('Contrato criado como rascunho')
      }
      setFormOpen(false)
      await load()
    } catch (err) {
      toast.error(errMsg(err) ?? 'Não foi possível salvar')
    } finally {
      setSaving(false)
    }
  }

  async function downloadPdf(c: Contract) {
    setBusyId(c.id)
    try {
      await contractsApi.downloadContractPdf(c.id)
    } catch (err) {
      toast.error(errMsg(err) ?? 'Erro ao gerar o PDF')
    } finally {
      setBusyId(null)
    }
  }

  function copyLink(url: string) {
    navigator.clipboard.writeText(url).then(() => toast.success('Link de assinatura copiado'), () => toast.error('Não foi possível copiar'))
  }

  function ask(kind: Confirm['kind'], contract: Contract) {
    if (kind === 'send' && !contract.clientEmail && !contract.clientPhone) {
      toast.error('Adicione e-mail ou telefone do contratante antes de enviar')
      return
    }
    setConfirm({ kind, contract })
  }

  async function runConfirm() {
    if (!confirm) return
    const { kind, contract } = confirm
    setConfirmBusy(true)
    try {
      if (kind === 'send') { await contractsApi.sendContract(contract.id); toast.success('Contrato enviado para assinatura') }
      if (kind === 'signed') { await contractsApi.markSigned(contract.id); toast.success('Contrato marcado como assinado') }
      if (kind === 'cancel') { await contractsApi.cancelContract(contract.id); toast.success('Contrato cancelado') }
      if (kind === 'delete') { await contractsApi.deleteContract(contract.id); toast.success('Rascunho excluído') }
      setConfirm(null)
      await load()
    } catch (err) {
      toast.error(errMsg(err) ?? (kind === 'send' ? 'Erro ao enviar (confira o token do ZapSign em Integrações)' : 'Não foi possível concluir'))
    } finally {
      setConfirmBusy(false)
    }
  }

  const totalSigned = contracts.filter((c) => c.status === 'SIGNED').reduce((s, c) => s + c.monthlyValue, 0)

  return (
    <div>
      <PageHeader
        title="Contratos"
        subtitle="Gere o contrato em PDF e colete a assinatura on-line pelo ZapSign"
        action={<Button onClick={openNew}><Plus size={15} className="mr-1.5" />Novo contrato</Button>}
      />

      <Card className="mb-5" padding={false}>
        <div className="p-3 flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex gap-1 flex-wrap">
            {FILTERS.map((f) => (
              <button
                key={f.value}
                type="button"
                onClick={() => setStatus(f.value)}
                className={cn(
                  'px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                  status === f.value ? 'bg-orange-500 text-white' : 'text-fg-muted hover:bg-surface-hover',
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="relative sm:ml-auto sm:w-72">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar contratante, CPF/CNPJ, e-mail"
              className="w-full rounded-lg border border-border bg-surface pl-9 pr-3 py-2 text-sm text-fg placeholder:text-fg-muted focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-400"
            />
          </div>
        </div>
      </Card>

      {loading ? (
        <div className="flex items-center justify-center py-16"><Spinner size="md" /></div>
      ) : contracts.length === 0 ? (
        <EmptyState
          icon={<FileText size={40} />}
          title={status || debounced ? 'Nenhum contrato com esse filtro' : 'Nenhum contrato ainda'}
          description={status || debounced ? undefined : 'Gere o primeiro contrato, a partir de um cliente ou preenchendo os dados à mão.'}
          action={!status && !debounced ? { label: 'Novo contrato', onClick: openNew } : undefined}
        />
      ) : (
        <>
          {status === 'SIGNED' && (
            <p className="text-xs text-fg-muted mb-3">{contracts.length} contrato(s) assinado(s) · {formatCurrency(totalSigned)}/mês</p>
          )}
          <div className="flex flex-col gap-3">
            {contracts.map((c) => {
              const st = STATUS[c.status]
              const busy = busyId === c.id
              const details = [
                c.clientDocument,
                `${formatCurrency(c.monthlyValue)}/mês`,
                c.setupFee > 0 ? `implantação ${formatCurrency(c.setupFee)}` : null,
                c.durationMonths ? `${c.durationMonths} meses` : 'prazo indeterminado',
                c.startDate ? `início ${fmtDay(c.startDate)}` : null,
              ].filter(Boolean).join(' · ')
              const when =
                c.status === 'SIGNED' ? `Assinado em ${fmtWhen(c.signedAt)}`
                  : c.status === 'CANCELLED' ? `Cancelado em ${fmtWhen(c.cancelledAt)}`
                    : `Criado em ${fmtWhen(c.createdAt)}`
              return (
                <Card key={c.id} padding={false}>
                  <div className="p-4 flex flex-col lg:flex-row lg:items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold text-fg truncate">{c.clientName}</p>
                        <span className={cn('text-xs font-medium px-2 py-0.5 rounded-full', st.cls)}>{st.label}</span>
                        {c.customer && <span className="text-xs text-fg-muted">· cliente vinculado</span>}
                      </div>
                      <p className="text-xs text-fg-muted mt-1">{details}</p>
                      <p className="text-xs text-fg-muted mt-0.5">{c.title} · {when}</p>
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap shrink-0">
                      <Button size="sm" variant="secondary" onClick={() => void downloadPdf(c)} loading={busy}><Download size={14} className="mr-1" />PDF</Button>
                      {c.signedPdfUrl && (
                        <a href={c.signedPdfUrl} target="_blank" rel="noreferrer" className="inline-flex items-center px-3 py-1.5 text-sm rounded-lg border border-border bg-surface text-fg hover:bg-surface-hover">
                          <ExternalLink size={14} className="mr-1" />Assinado
                        </a>
                      )}
                      {c.status === 'SENT' && c.signUrl && (
                        <Button size="sm" variant="secondary" onClick={() => copyLink(c.signUrl!)}><Copy size={14} className="mr-1" />Link</Button>
                      )}
                      {c.status === 'DRAFT' && (
                        <Button size="sm" onClick={() => ask('send', c)}><Send size={14} className="mr-1" />Enviar p/ assinar</Button>
                      )}
                      {(c.status === 'DRAFT' || c.status === 'SENT') && (
                        <IconAction label="Dar baixa manual" onClick={() => ask('signed', c)}><CheckCircle2 size={15} /></IconAction>
                      )}
                      {c.status === 'DRAFT' && (
                        <IconAction label="Editar" onClick={() => openEdit(c)}><Pencil size={15} /></IconAction>
                      )}
                      {c.status === 'SENT' && (
                        <IconAction label="Cancelar contrato" danger onClick={() => ask('cancel', c)}><Ban size={15} /></IconAction>
                      )}
                      {c.status === 'DRAFT' && (
                        <IconAction label="Excluir rascunho" danger onClick={() => ask('delete', c)}><Trash2 size={15} /></IconAction>
                      )}
                    </div>
                  </div>
                </Card>
              )
            })}
          </div>
        </>
      )}

      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editingId ? 'Editar contrato' : 'Novo contrato'}
        size="xl"
        footer={
          <>
            <Button variant="secondary" onClick={() => setFormOpen(false)} disabled={saving}>Cancelar</Button>
            <Button onClick={() => void save()} loading={saving} disabled={!form.clientName.trim()}>{editingId ? 'Salvar' : 'Criar rascunho'}</Button>
          </>
        }
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <Select
              label="Cliente do CRM (opcional, preenche os dados)"
              value={form.customerId}
              onChange={(e) => pickCustomer(e.target.value)}
              placeholder="Sem vínculo: preencher à mão"
              options={customers.map((c) => ({ value: c.id, label: c.name }))}
            />
          </div>
          <div className="sm:col-span-2"><Input label="Nome / razão social *" value={form.clientName} onChange={(e) => set('clientName', e.target.value)} /></div>
          <Input label="CPF / CNPJ" value={form.clientDocument} onChange={(e) => set('clientDocument', e.target.value)} />
          <Input label="E-mail (recebe o link de assinatura)" type="email" value={form.clientEmail} onChange={(e) => set('clientEmail', e.target.value)} placeholder="cliente@empresa.com.br" />
          <Input label="WhatsApp (recebe o link de assinatura)" value={form.clientPhone} onChange={(e) => set('clientPhone', e.target.value)} placeholder="(48) 99999-9999" />
          <Input label="Endereço" value={form.clientAddress} onChange={(e) => set('clientAddress', e.target.value)} />
          <div className="sm:col-span-2"><Input label="Título do contrato" value={form.title} onChange={(e) => set('title', e.target.value)} /></div>
          <Input label="Mensalidade (R$)" type="number" step="0.01" min="0" value={form.monthlyValue} onChange={(e) => set('monthlyValue', e.target.value)} />
          <Input label="Implantação (R$, cobrada uma vez)" type="number" step="0.01" min="0" value={form.setupFee} onChange={(e) => set('setupFee', e.target.value)} />
          <Input label="Dia do vencimento" type="number" min="1" max="31" value={form.paymentDay} onChange={(e) => set('paymentDay', e.target.value)} placeholder="Ex.: 10" />
          <Input label="Vigência (meses; vazio = indeterminado)" type="number" min="1" max="120" value={form.durationMonths} onChange={(e) => set('durationMonths', e.target.value)} />
          <Input label="Início" type="date" value={form.startDate} onChange={(e) => set('startDate', e.target.value)} />
          <div className="sm:col-span-2">
            <Textarea label="Objeto do contrato" rows={2} value={form.serviceObject} onChange={(e) => set('serviceObject', e.target.value)} placeholder="Vazio usa o padrão: gestão de tráfego pago (Meta Ads, Google Ads) para geração de leads" />
          </div>
          <div className="sm:col-span-2">
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Cláusulas</span>
              <Button size="sm" variant="ghost" onClick={() => void loadTemplate()} loading={loadingTemplate}>
                <FileSignature size={14} className="mr-1" />{form.bodyText ? 'Recarregar modelo padrão' : 'Editar a partir do modelo'}
              </Button>
            </div>
            <Textarea
              rows={form.bodyText ? 12 : 3}
              className="font-mono text-xs"
              value={form.bodyText}
              onChange={(e) => set('bodyText', e.target.value)}
              placeholder="Vazio gera as cláusulas padrão com os valores acima. Separe as cláusulas com uma linha em branco."
            />
          </div>
          <div className="sm:col-span-2"><Textarea label="Observações internas (não vão no PDF)" rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} /></div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!confirm}
        onClose={() => setConfirm(null)}
        onConfirm={() => void runConfirm()}
        title={confirm ? CONFIRM_TEXT[confirm.kind].title : undefined}
        message={confirm ? CONFIRM_TEXT[confirm.kind].message(confirm.contract) : ''}
        confirmLabel={confirm ? CONFIRM_TEXT[confirm.kind].label : undefined}
        loading={confirmBusy}
      />
    </div>
  )
}

function IconAction({ label, danger, onClick, children }: { label: string; danger?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={cn('p-2 rounded-lg transition-colors', danger ? 'text-tone-red-fg hover:bg-tone-red-bg' : 'text-fg-muted hover:bg-surface-hover')}
    >
      {children}
    </button>
  )
}
