// Seleção dos leads que merecem o Place Details ENTERPRISE (telefone, website, nota, avaliações): orçamento escasso (1.000/mês
// grátis), então só entram os PRIORIZADOS e necessários. Evita: duplicados, leads que já têm evidência vigente do Google,
// leads em processamento. Fechados e fora da cidade já são descartados na descoberta (Text Search PRO).
// Antes do Details não há telefone nem avaliações: a prioridade usa só o que o Pro entrega (tipo do lugar x aba, endereço completo).
import { prisma } from '../config/database'
import { env } from '../config/env'
import { currentBlock, remainingBudget } from './api-quota.service'
import { fold } from './contact-normalize'
import { GOOGLE_COLLECTION_VERSIONS } from './website-types'
import { kick } from './site-classify-queue.service'

export interface DetailsCandidate { id: string; arenaName: string; address: string | null; primaryType: string | null; city: string | null; state: string | null; createdAt: Date }

const tokens = (terms: string[]) => [...new Set(terms.flatMap((t) => fold(t).split(/[^a-z0-9]+/)).filter((x) => x.length >= 4))]

// Maior = mais promissor. Só usa campos do Text Search Pro.
export function detailsPriority(l: Pick<DetailsCandidate, 'address' | 'primaryType' | 'city' | 'state'>, nichoTermos: string[]): number {
  let score = 0
  const type = fold((l.primaryType ?? '').replace(/_/g, ' '))
  if (type && tokens(nichoTermos).some((t) => type.includes(t) || t.includes(type.split(' ')[0] ?? '#'))) score += 2 // o tipo do lugar combina com a aba
  if (l.address && /\d/.test(l.address)) score += 1 // endereço com número: negócio real, não só um ponto
  if (l.city && l.state) score += 1
  return score
}

const dupKey = (l: Pick<DetailsCandidate, 'arenaName' | 'address'>) => `${fold(l.arenaName).replace(/[^a-z0-9]/g, '')}|${fold(l.address ?? '').replace(/[^a-z0-9]/g, '').slice(0, 40)}`

export async function selectLeadsForDetails(o: { nichoId: string; nichoTermos: string[]; ids?: string[]; limite?: number; now?: Date }) {
  const now = o.now ?? new Date()
  const saldo = await remainingBudget('GOOGLE_PLACE_DETAILS_ENTERPRISE', now) // null = bloqueado por config
  const cap = Math.min(o.limite ?? env.GOOGLE_DETAILS_ENRICH_MAX_PER_REQUEST, env.GOOGLE_DETAILS_ENRICH_MAX_PER_REQUEST, env.GOOGLE_PLACE_DETAILS_ENTERPRISE_MAX_CALLS_PER_RUN)
  const limite = saldo == null ? 0 : Math.min(cap, saldo)
  const leads = await prisma.prospect.findMany({
    where: { nichoId: o.nichoId, placeId: { not: null }, ...(o.ids ? { id: { in: o.ids } } : {}), OR: [{ investigationState: null }, { investigationState: { not: 'PROCESSING' } }] },
    select: { id: true, arenaName: true, address: true, primaryType: true, city: true, state: true, createdAt: true },
  })
  const ttl = env.GOOGLE_EVIDENCE_TTL_HOURS * 3600_000
  const have = await prisma.leadEvidence.findMany({
    where: { prospectId: { in: leads.map((l) => l.id) }, source: 'GOOGLE', type: 'PLACE_FIELDS', version: { in: GOOGLE_COLLECTION_VERSIONS }, collectedAt: { gt: new Date(now.getTime() - ttl) } },
    select: { prospectId: true },
  })
  const done = new Set(have.map((h) => h.prospectId))
  const pending = leads.filter((l) => !done.has(l.id)) // já tem Details vigente: não paga de novo
  const seen = new Set<string>()
  let duplicados = 0
  const unique = [...pending].sort((a, b) => detailsPriority(b, o.nichoTermos) - detailsPriority(a, o.nichoTermos) || a.createdAt.getTime() - b.createdAt.getTime()).filter((l) => {
    const k = dupKey(l); if (seen.has(k)) { duplicados++; return false } // mesmo nome+endereço: um só Details
    seen.add(k); return true
  })
  const selecionados = unique.slice(0, limite).map((l) => l.id)
  const aguardando = unique.length - selecionados.length
  // Quando retomar: sem saldo, só quando a janela do orçamento virar (retryAt); limitado só pelo lote, já dá para retomar agora.
  let retomarEm: Date | null = null
  let motivoEspera: 'SALDO' | 'LOTE' | null = null
  if (aguardando > 0) {
    if (saldo == null || saldo <= 0 || saldo <= selecionados.length) {
      motivoEspera = 'SALDO'
      retomarEm = saldo == null ? null : (await currentBlock('GOOGLE_PLACE_DETAILS_ENTERPRISE'))?.retryAt ?? null
    } else motivoEspera = 'LOTE'
  }
  return { selecionados, aguardando, ignorados: { duplicados, jaComDetails: leads.length - pending.length }, limite, saldo, motivoEspera, retomarEm }
}

export async function enqueueDetails(ids: string[]): Promise<void> {
  if (!ids.length) return
  await prisma.prospect.updateMany({
    where: { id: { in: ids }, OR: [{ investigationState: null }, { investigationState: { not: 'PROCESSING' } }] },
    data: { investigationState: 'PENDING', investigationNextRunAt: new Date(), investigationNextAction: 'GOOGLE_DETAILS', investigationWaitReason: null, investigationAttempts: 0, investigationLastError: null, investigationLockedBy: null, investigationLockedUntil: null, investigationLockToken: null },
  })
  kick()
}
