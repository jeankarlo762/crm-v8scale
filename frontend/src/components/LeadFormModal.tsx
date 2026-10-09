import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import toast from 'react-hot-toast'
import { Modal } from './ui/Modal'
import { Button } from './ui/Button'
import { Input } from './ui/Input'
import { Select } from './ui/Select'
import { Textarea } from './ui/Textarea'
import { ownerOptions } from '../utils/owners'
import * as api from '../api/commercial.api'
import { errMsg } from '../utils/apiError'
import { toDateInput } from '../utils/format'
import { LEAD_SOURCES, type Lead, type LeadInput, type Stage, type UserRef } from '../types'

const schema = z.object({
  name: z.string().trim().min(1, 'Nome obrigatório'),
  contactName: z.string().optional(),
  email: z.union([z.string().trim().email('Email inválido'), z.literal('')]).optional(),
  phone: z.string().optional(),
  document: z.string().optional(),
  city: z.string().optional(),
  state: z.string().max(2, 'Use a sigla (ex.: SP)').optional(),
  source: z.string().optional(),
  segment: z.string().optional(),
  value: z.number({ invalid_type_error: 'Valor inválido' }).min(0, 'Valor inválido'),
  expectedCloseAt: z.string().optional(),
  ownerId: z.string().optional(),
  stageId: z.string().optional(),
  notes: z.string().optional(),
})

type FormData = z.infer<typeof schema>

const nz = (v?: string) => (v && v.trim() ? v.trim() : null)

interface Props {
  open: boolean
  onClose: () => void
  /** Sem `lead` = criação. */
  lead?: Lead | null
  stages: Stage[]
  users: UserRef[]
  /** Gerente/admin podem escolher o responsável; vendedor sempre é o dono. */
  canAssign: boolean
  defaultStageId?: string
  onSaved: (lead: Lead) => void
}

export function LeadFormModal({ open, onClose, lead, stages, users, canAssign, defaultStageId, onSaved }: Props) {
  const editing = !!lead
  const openStages = stages.filter((s) => s.kind === 'OPEN')

  const {
    register, handleSubmit, reset, formState: { errors, isSubmitting },
  } = useForm<FormData>({ resolver: zodResolver(schema), defaultValues: { value: 0 } })

  useEffect(() => {
    if (!open) return
    reset({
      name: lead?.name ?? '',
      contactName: lead?.contactName ?? '',
      email: lead?.email ?? '',
      phone: lead?.phone ?? '',
      document: lead?.document ?? '',
      city: lead?.city ?? '',
      state: lead?.state ?? '',
      source: lead?.source ?? '',
      segment: lead?.segment ?? '',
      value: lead?.value ?? 0,
      expectedCloseAt: toDateInput(lead?.expectedCloseAt ?? null),
      ownerId: lead?.ownerId ?? '',
      stageId: defaultStageId ?? openStages[0]?.id ?? '',
      notes: lead?.notes ?? '',
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, lead?.id])

  async function onSubmit(data: FormData) {
    const payload: LeadInput = {
      name: data.name.trim(),
      contactName: nz(data.contactName),
      email: nz(data.email),
      phone: nz(data.phone),
      document: nz(data.document),
      city: nz(data.city),
      state: nz(data.state)?.toUpperCase() ?? null,
      source: nz(data.source),
      segment: nz(data.segment),
      value: data.value,
      expectedCloseAt: nz(data.expectedCloseAt),
      notes: nz(data.notes),
    }
    try {
      let saved: Lead
      if (editing && lead) {
        // Só manda o responsável se ele mudou: assim editar outro campo nunca
        // apaga/troca o dono por acidente (ex.: lista de usuários ainda carregando).
        const newOwner = data.ownerId || null
        const ownerChanged = canAssign && newOwner !== (lead.ownerId ?? null)
        saved = await api.updateLead(lead.id, { ...payload, ...(ownerChanged && { ownerId: newOwner }) })
        toast.success('Lead atualizado')
      } else {
        saved = await api.createLead({
          ...payload,
          stageId: data.stageId || undefined,
          ...(canAssign && data.ownerId && { ownerId: data.ownerId }),
        })
        toast.success('Lead criado')
      }
      onSaved(saved)
      onClose()
    } catch (err) {
      toast.error(errMsg(err) ?? 'Não foi possível salvar o lead')
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? 'Editar lead' : 'Novo lead'}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={isSubmitting}>Cancelar</Button>
          <Button onClick={handleSubmit(onSubmit)} loading={isSubmitting}>{editing ? 'Salvar' : 'Criar lead'}</Button>
        </>
      }
    >
      <form onSubmit={handleSubmit(onSubmit)} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="sm:col-span-2">
          <Input label="Empresa / Lead *" autoFocus error={errors.name?.message} {...register('name')} />
        </div>
        <Input label="Contato" error={errors.contactName?.message} {...register('contactName')} />
        <Input label="E-mail" type="email" error={errors.email?.message} {...register('email')} />
        <Input label="Telefone / WhatsApp" inputMode="tel" error={errors.phone?.message} {...register('phone')} />
        <Input label="CPF / CNPJ" error={errors.document?.message} {...register('document')} />
        <Input label="Cidade" error={errors.city?.message} {...register('city')} />
        <Input label="UF" maxLength={2} error={errors.state?.message} {...register('state')} />

        <Select
          label="Origem"
          options={[{ value: '', label: '—' }, ...LEAD_SOURCES.map((s) => ({ value: s, label: s }))]}
          {...register('source')}
        />
        <Input label="Segmento" placeholder="Ex.: arenas esportivas" error={errors.segment?.message} {...register('segment')} />

        <Input
          label="Valor estimado (R$)"
          type="number"
          step="0.01"
          min="0"
          error={errors.value?.message}
          {...register('value', { valueAsNumber: true })}
        />
        <Input label="Previsão de fechamento" type="date" {...register('expectedCloseAt')} />

        {!editing && (
          <Select
            label="Etapa inicial"
            options={openStages.map((s) => ({ value: s.id, label: s.name }))}
            {...register('stageId')}
          />
        )}
        {canAssign && (
          <Select
            label="Responsável"
            options={ownerOptions(users, lead?.owner ?? null, editing ? 'Sem responsável' : 'Eu mesmo')}
            {...register('ownerId')}
          />
        )}

        <div className="sm:col-span-2">
          <Textarea label="Observações" rows={3} {...register('notes')} />
        </div>
      </form>
    </Modal>
  )
}
