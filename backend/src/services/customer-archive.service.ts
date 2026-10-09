import { prisma } from '../config/database'
import { httpError } from '../utils/errors'

/**
 * Arquivar cliente = tirar da lista de Clientes e inativar (sai do MRR). Se o cliente estava ativo, o arquivamento é o que o
 * inativa e por isso grava churnedAt == archivedAt; se já tinha cancelado antes, o churnedAt original é preservado.
 * Ao desarquivar, só reativa quem foi inativado pelo próprio arquivamento (churnedAt == archivedAt).
 */
export async function archiveCustomer(id: string, reason: string | null | undefined, scope: object = {}) {
  const c = await prisma.customer.findFirst({ where: { id, ...scope }, select: { id: true, active: true, archivedAt: true } })
  if (!c) throw httpError(404, 'Cliente não encontrado')
  if (c.archivedAt) throw httpError(409, 'Cliente já está arquivado')
  const now = new Date()
  return prisma.customer.update({
    where: { id },
    data: { archivedAt: now, archiveReason: reason?.trim() || null, ...(c.active ? { active: false, churnedAt: now } : {}) },
  })
}

export async function unarchiveCustomer(id: string, scope: object = {}) {
  const c = await prisma.customer.findFirst({ where: { id, ...scope }, select: { id: true, active: true, archivedAt: true, churnedAt: true } })
  if (!c) throw httpError(404, 'Cliente não encontrado')
  if (!c.archivedAt) throw httpError(409, 'Cliente não está arquivado')
  const inactivatedByArchive = !c.active && !!c.churnedAt && c.churnedAt.getTime() === c.archivedAt.getTime()
  return prisma.customer.update({
    where: { id },
    data: { archivedAt: null, archiveReason: null, ...(inactivatedByArchive ? { active: true, churnedAt: null } : {}) },
  })
}
