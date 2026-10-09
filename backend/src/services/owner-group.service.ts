// Agrupa leads com o mesmo CELULAR (placeIds diferentes) num ownerGroupId; fixo compartilhado (recepção/PBX) não conta. O id é derivado do
// E.164, então é estável e não precisa de coordenação. Lead sozinho no telefone fica com null.
import { prisma } from '../config/database'
import { computeLeadScore } from './lead-score.service'

export function ownerGroupIdFor(phoneE164: string): string {
  return `tel:${phoneE164}`
}

// Recalcula grupos e scores dos leads que têm algum dos telefones informados.
export async function syncOwnerGroups(phones: (string | null | undefined)[]): Promise<void> {
  const uniq = [...new Set(phones.filter((p): p is string => !!p))]
  for (const phone of uniq) {
    const members = await prisma.prospect.findMany({ where: { phoneE164: phone } })
    const groupId = members.length >= 2 && members.every((m) => m.phoneMobile === true) ? ownerGroupIdFor(phone) : null
    for (const m of members) {
      const next = { ...m, ownerGroupId: groupId }
      await prisma.prospect.update({ where: { id: m.id }, data: { ownerGroupId: groupId, leadScore: computeLeadScore({ ...next, ownerGroupSize: groupId ? members.length : 1 }) } })
    }
  }
}

// Tamanho do grupo do lead (1 quando sozinho), para o cálculo do score.
export async function ownerGroupSize(lead: { ownerGroupId: string | null }): Promise<number> {
  return lead.ownerGroupId ? prisma.prospect.count({ where: { ownerGroupId: lead.ownerGroupId } }) : 1
}

// Anexa aos leads o tamanho do grupo e os nomes dos demais negócios (tooltip do selo).
export async function withOwnerGroups<T extends { id: string; ownerGroupId: string | null }>(leads: T[]) {
  const ids = [...new Set(leads.map((l) => l.ownerGroupId).filter((g): g is string => !!g))]
  const rows = ids.length ? await prisma.prospect.findMany({ where: { ownerGroupId: { in: ids } }, select: { id: true, ownerGroupId: true, arenaName: true } }) : []
  return leads.map((l) => {
    const group = l.ownerGroupId ? rows.filter((r) => r.ownerGroupId === l.ownerGroupId) : []
    return { ...l, ownerGroupSize: group.length || 1, ownerGroupNames: group.filter((r) => r.id !== l.id).map((r) => r.arenaName) }
  })
}
