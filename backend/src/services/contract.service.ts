import { Contract, Prisma } from '@prisma/client'
import { prisma } from '../config/database'
import { httpError } from '../utils/errors'
import { ContractPdfInput, generateContractPdf } from './contract-pdf.service'
import { createDocument, parseWebhook } from './zapsign.service'

export const CONTRACT_STATUSES = ['DRAFT', 'SENT', 'SIGNED', 'CANCELLED'] as const
export type ContractStatus = (typeof CONTRACT_STATUSES)[number]

export interface ContractInput {
  customerId?: string | null
  clientName?: string
  clientDocument?: string | null
  clientEmail?: string | null
  clientPhone?: string | null
  clientAddress?: string | null
  title?: string
  serviceObject?: string | null
  monthlyValue?: number
  setupFee?: number
  paymentDay?: number | null
  startDate?: string | null
  durationMonths?: number | null
  bodyText?: string | null
  notes?: string | null
}

const include = { customer: { select: { id: true, name: true } } } satisfies Prisma.ContractInclude
type ContractWithCustomer = Prisma.ContractGetPayload<{ include: typeof include }>

export function serialize(c: ContractWithCustomer) {
  return { ...c, monthlyValue: Number(c.monthlyValue), setupFee: Number(c.setupFee) }
}

// "AAAA-MM-DD" → meia-noite UTC (só o dia importa).
function toDate(v: string | null | undefined): Date | null | undefined {
  if (v === undefined) return undefined
  return v ? new Date(`${v}T00:00:00Z`) : null
}

async function assertCustomer(customerId: string | null | undefined) {
  if (!customerId) return
  const exists = await prisma.customer.findUnique({ where: { id: customerId }, select: { id: true } })
  if (!exists) throw httpError(400, 'Cliente não encontrado')
}

// Campos escalares do contrato (o vínculo com o cliente é tratado à parte por create/update).
function dataFrom(input: ContractInput) {
  const { startDate, monthlyValue, setupFee, ...rest } = input
  delete rest.customerId
  return {
    ...rest,
    ...(monthlyValue !== undefined && { monthlyValue }),
    ...(setupFee !== undefined && { setupFee }),
    ...(startDate !== undefined && { startDate: toDate(startDate) }),
  }
}

export async function listContracts(filters: { status?: ContractStatus; q?: string; customerId?: string }) {
  const where: Prisma.ContractWhereInput = {
    ...(filters.status && { status: filters.status }),
    ...(filters.customerId && { customerId: filters.customerId }),
    ...(filters.q && {
      OR: [
        { clientName: { contains: filters.q, mode: 'insensitive' } },
        { clientDocument: { contains: filters.q } },
        { clientEmail: { contains: filters.q, mode: 'insensitive' } },
      ],
    }),
  }
  const rows = await prisma.contract.findMany({ where, include, orderBy: { createdAt: 'desc' }, take: 500 })
  return rows.map(serialize)
}

async function getRaw(id: string): Promise<ContractWithCustomer> {
  const c = await prisma.contract.findUnique({ where: { id }, include })
  if (!c) throw httpError(404, 'Contrato não encontrado')
  return c
}

export async function getContract(id: string) {
  return serialize(await getRaw(id))
}

export async function createContract(input: ContractInput & { clientName: string }, createdById: string) {
  await assertCustomer(input.customerId)
  const c = await prisma.contract.create({
    data: { ...dataFrom(input), clientName: input.clientName, customerId: input.customerId ?? null, createdById },
    include,
  })
  return serialize(c)
}

export async function updateContract(id: string, input: ContractInput) {
  const existing = await getRaw(id)
  // Contrato enviado/assinado não muda de termos: cancele e gere outro.
  if (existing.status !== 'DRAFT') throw httpError(409, 'Só é possível editar contratos em rascunho. Cancele e gere um novo.')
  if (input.customerId !== undefined) await assertCustomer(input.customerId)
  const c = await prisma.contract.update({
    where: { id },
    data: { ...dataFrom(input), ...(input.customerId !== undefined && { customerId: input.customerId }) },
    include,
  })
  return serialize(c)
}

export async function deleteContract(id: string) {
  const existing = await getRaw(id)
  // Documento já enviado é histórico legal: não se apaga, cancela.
  if (existing.status !== 'DRAFT') throw httpError(409, 'Contrato enviado ou assinado não pode ser excluído. Cancele-o.')
  await prisma.contract.delete({ where: { id } })
}

export async function cancelContract(id: string) {
  const existing = await getRaw(id)
  if (existing.status === 'CANCELLED') return serialize(existing)
  if (existing.status === 'SIGNED') throw httpError(409, 'Contrato assinado não pode ser cancelado por aqui. Registre a rescisão.')
  const c = await prisma.contract.update({ where: { id }, data: { status: 'CANCELLED', cancelledAt: new Date() }, include })
  return serialize(c)
}

function toPdfInput(c: Contract): ContractPdfInput {
  return {
    id: c.id,
    title: c.title,
    clientName: c.clientName,
    clientDocument: c.clientDocument,
    clientEmail: c.clientEmail,
    clientPhone: c.clientPhone,
    clientAddress: c.clientAddress,
    serviceObject: c.serviceObject,
    monthlyValue: Number(c.monthlyValue),
    setupFee: Number(c.setupFee),
    paymentDay: c.paymentDay,
    startDate: c.startDate,
    durationMonths: c.durationMonths,
    bodyText: c.bodyText,
  }
}

export async function generatePdf(id: string): Promise<{ buffer: Buffer; filename: string }> {
  const c = await getRaw(id)
  const buffer = await generateContractPdf(toPdfInput(c))
  const safeName = c.clientName.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase()
  return { buffer, filename: `contrato-${safeName || 'cliente'}-${c.id.slice(-6)}.pdf` }
}

/** Gera o PDF e manda para assinatura no ZapSign. */
export async function sendForSignature(id: string) {
  const c = await getRaw(id)
  if (c.status !== 'DRAFT') throw httpError(409, 'Só contratos em rascunho podem ser enviados para assinatura')
  if (!c.clientEmail && !c.clientPhone) throw httpError(400, 'Informe o e-mail ou o telefone do cliente para enviar a assinatura')

  const buffer = await generateContractPdf(toPdfInput(c))
  const { token, signUrl } = await createDocument({
    name: `${c.title} — ${c.clientName}`,
    base64Pdf: buffer.toString('base64'),
    signerName: c.clientName,
    signerEmail: c.clientEmail,
    signerPhone: c.clientPhone,
    externalId: c.id,
  })
  const updated = await prisma.contract.update({ where: { id }, data: { status: 'SENT', zapsignToken: token, signUrl }, include })
  return serialize(updated)
}

/** Baixa manual (assinatura em papel ou fora do ZapSign). */
export async function markSigned(id: string) {
  const c = await getRaw(id)
  if (c.status === 'SIGNED') return serialize(c)
  if (c.status === 'CANCELLED') throw httpError(409, 'Contrato cancelado não pode ser marcado como assinado')
  const updated = await prisma.contract.update({ where: { id }, data: { status: 'SIGNED', signed: true, signedAt: new Date() }, include })
  return serialize(updated)
}

/** Webhook do ZapSign: quando o cliente assina, dá baixa automática. */
export async function handleWebhook(payload: unknown): Promise<{ handled: boolean }> {
  const w = parseWebhook(payload)
  if (!w.isSigned) return { handled: false }
  const contract =
    (w.token && (await prisma.contract.findFirst({ where: { zapsignToken: w.token } }))) ||
    (w.externalId && (await prisma.contract.findUnique({ where: { id: w.externalId } }))) ||
    null
  if (!contract || contract.status === 'CANCELLED') return { handled: false }
  if (contract.signed) return { handled: true }
  await prisma.contract.update({
    where: { id: contract.id },
    data: { status: 'SIGNED', signed: true, signedAt: new Date(), ...(w.signedFileUrl && { signedPdfUrl: w.signedFileUrl }) },
  })
  return { handled: true }
}
