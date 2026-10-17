import { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { Car, Pencil, Plus, Trash2 } from 'lucide-react'
import { PageHeader } from '../../components/layout/AppLayout'
import { Button } from '../../components/ui/Button'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { EmptyState } from '../../components/ui/EmptyState'
import { Input } from '../../components/ui/Input'
import { Modal } from '../../components/ui/Modal'
import { Select } from '../../components/ui/Select'
import { Spinner } from '../../components/ui/Spinner'
import { Table } from '../../components/ui/Table'
import { Textarea } from '../../components/ui/Textarea'
import * as aiApi from '../../api/ai.api'
import type { Vehicle, VehicleInput, VehicleStatus } from '../../api/ai.api'
import { useAuthStore } from '../../store/auth.store'
import { errMsg } from '../../utils/apiError'
import { formatCurrency } from '../../utils/format'

const STATUS_LABEL: Record<VehicleStatus, string> = { AVAILABLE: 'Disponível', RESERVED: 'Reservado', SOLD: 'Vendido' }
const STATUS_STYLE: Record<VehicleStatus, string> = {
  AVAILABLE: 'bg-tone-green-bg text-tone-green-fg',
  RESERVED: 'bg-tone-amber-bg text-tone-amber-fg',
  SOLD: 'bg-surface-hover text-fg-muted',
}

const EMPTY: VehicleInput = {
  brand: '', model: '', version: null, year: null, price: 0, km: null, color: null, fuel: null,
  transmission: null, plate: null, description: null, photoUrl: null, status: 'AVAILABLE',
}

const num = (v: string) => (v.trim() === '' ? null : Number(v))
const txt = (v: string) => v || null

function VehicleModal({ vehicle, onClose, onSaved }: { vehicle: Vehicle | 'new' | null; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<VehicleInput>(EMPTY)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (vehicle === 'new') setForm(EMPTY)
    else if (vehicle) { const { id: _id, ...rest } = vehicle; setForm(rest) }
  }, [vehicle])

  const set = <K extends keyof VehicleInput>(k: K, v: VehicleInput[K]) => setForm((f) => ({ ...f, [k]: v }))

  async function save() {
    if (!form.brand.trim() || !form.model.trim()) { toast.error('Informe marca e modelo'); return }
    setSaving(true)
    try {
      if (vehicle === 'new') await aiApi.createVehicle(form)
      else if (vehicle) await aiApi.updateVehicle(vehicle.id, form)
      toast.success('Veículo salvo')
      onSaved()
      onClose()
    } catch (err) {
      toast.error(errMsg(err) ?? 'Não foi possível salvar')
    } finally { setSaving(false) }
  }

  return (
    <Modal
      open={!!vehicle}
      onClose={onClose}
      title={vehicle === 'new' ? 'Novo veículo' : 'Editar veículo'}
      size="lg"
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button onClick={() => void save()} loading={saving}>Salvar</Button></>}
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Input label="Marca" value={form.brand} onChange={(e) => set('brand', e.target.value)} />
        <Input label="Modelo" value={form.model} onChange={(e) => set('model', e.target.value)} />
        <Input label="Versão" value={form.version ?? ''} onChange={(e) => set('version', txt(e.target.value))} />
        <Input label="Ano" type="number" value={form.year ?? ''} onChange={(e) => set('year', num(e.target.value))} />
        <Input label="Preço (R$)" type="number" value={form.price} onChange={(e) => set('price', Number(e.target.value) || 0)} />
        <Input label="Km" type="number" value={form.km ?? ''} onChange={(e) => set('km', num(e.target.value))} />
        <Input label="Cor" value={form.color ?? ''} onChange={(e) => set('color', txt(e.target.value))} />
        <Input label="Combustível" value={form.fuel ?? ''} onChange={(e) => set('fuel', txt(e.target.value))} />
        <Input label="Câmbio" value={form.transmission ?? ''} onChange={(e) => set('transmission', txt(e.target.value))} />
        <Input label="Placa" value={form.plate ?? ''} onChange={(e) => set('plate', txt(e.target.value))} />
        <Select
          label="Situação"
          value={form.status}
          onChange={(e) => set('status', e.target.value as VehicleStatus)}
          options={(Object.keys(STATUS_LABEL) as VehicleStatus[]).map((s) => ({ value: s, label: STATUS_LABEL[s] }))}
        />
        <Input label="Foto (URL)" value={form.photoUrl ?? ''} onChange={(e) => set('photoUrl', txt(e.target.value))} />
        <div className="sm:col-span-2">
          <Textarea label="Observações (opcionais, a IA usa)" value={form.description ?? ''} onChange={(e) => set('description', txt(e.target.value))} placeholder="Único dono, revisões em dia, aceita troca..." />
        </div>
      </div>
    </Modal>
  )
}

export default function VeiculosPage() {
  const canEdit = useAuthStore((s) => s.hasRole('ADMIN', 'MANAGER'))
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Vehicle | 'new' | null>(null)
  const [removing, setRemoving] = useState<Vehicle | null>(null)

  const load = useCallback(async () => {
    try { setVehicles(await aiApi.listVehicles()) }
    catch (err) { toast.error(errMsg(err) ?? 'Erro ao carregar o estoque') }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])

  async function remove() {
    if (!removing) return
    try {
      await aiApi.deleteVehicle(removing.id)
      toast.success('Veículo removido')
      setRemoving(null)
      void load()
    } catch (err) { toast.error(errMsg(err) ?? 'Não foi possível remover') }
  }

  return (
    <div>
      <PageHeader
        title="Estoque"
        subtitle="Catálogo que a IA consulta para responder sobre os carros (só os disponíveis são oferecidos)"
        action={canEdit ? <Button onClick={() => setEditing('new')}><Plus size={16} /> Novo veículo</Button> : undefined}
      />
      {loading ? (
        <div className="flex justify-center py-16"><Spinner size="md" /></div>
      ) : vehicles.length === 0 ? (
        <EmptyState icon={<Car size={32} />} title="Nenhum veículo cadastrado" description="Cadastre o estoque para a IA responder com preço, ano e quilometragem corretos." />
      ) : (
        <Table
          data={vehicles}
          keyExtractor={(v) => v.id}
          columns={[
            { key: 'car', header: 'Veículo', cell: (v) => <div><p className="text-sm font-medium text-fg">{v.brand} {v.model}</p><p className="text-xs text-fg-muted">{[v.version, v.color].filter(Boolean).join(' · ')}</p></div> },
            { key: 'year', header: 'Ano', cell: (v) => v.year ?? '—' },
            { key: 'km', header: 'Km', cell: (v) => (v.km != null ? v.km.toLocaleString('pt-BR') : '—') },
            { key: 'price', header: 'Preço', cell: (v) => formatCurrency(v.price) },
            { key: 'status', header: 'Situação', cell: (v) => <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${STATUS_STYLE[v.status]}`}>{STATUS_LABEL[v.status]}</span> },
            ...(canEdit ? [{
              key: 'actions', header: '', className: 'w-24',
              cell: (v: Vehicle) => (
                <div className="flex gap-1 justify-end">
                  <button aria-label="Editar" onClick={() => setEditing(v)} className="p-1.5 rounded-lg text-fg-muted hover:bg-surface-hover hover:text-fg"><Pencil size={15} /></button>
                  <button aria-label="Remover" onClick={() => setRemoving(v)} className="p-1.5 rounded-lg text-fg-muted hover:bg-tone-red-bg hover:text-tone-red-fg"><Trash2 size={15} /></button>
                </div>
              ),
            }] : []),
          ]}
        />
      )}
      <VehicleModal vehicle={editing} onClose={() => setEditing(null)} onSaved={() => void load()} />
      <ConfirmDialog
        open={!!removing}
        title="Remover veículo"
        message={`Remover ${removing?.brand} ${removing?.model} do estoque?`}
        confirmLabel="Remover"
        onClose={() => setRemoving(null)}
        onConfirm={() => void remove()}
      />
    </div>
  )
}
