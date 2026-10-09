// Reprocessa telefone (E.164), grupos de mesmo dono (só celular) e leadScore de TODOS os leads.
// Uso: tsx prisma/reprocess-scores.ts [--apply]   (sem --apply é simulação: não grava nada)
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { parsePhone } from '../src/services/phone.service'
import { ownerGroupIdFor } from '../src/services/owner-group.service'
import { computeLeadScore } from '../src/services/lead-score.service'

const prisma = new PrismaClient()
const apply = process.argv.includes('--apply')

async function main() {
  const leads = await prisma.prospect.findMany()
  // Telefone: E.164 faltando é derivado do whatsapp (em memória; gravado só com --apply).
  const phones = leads.map((l) => {
    if (l.phoneE164) return { e164: l.phoneE164, mobile: l.phoneMobile, country: l.phoneCountry, backfill: false }
    const parsed = l.whatsapp ? parsePhone([l.whatsapp]) : null
    return parsed ? { e164: parsed.e164, mobile: parsed.isMobile, country: parsed.country, backfill: true } : null
  })
  const byPhone = new Map<string, number[]>()
  phones.forEach((p, i) => { if (p) byPhone.set(p.e164, [...(byPhone.get(p.e164) ?? []), i]) })

  let mudou = 0
  let grupos = 0
  for (let i = 0; i < leads.length; i++) {
    const l = leads[i]
    const p = phones[i]
    const members = p ? byPhone.get(p.e164) ?? [] : []
    const grouped = !!p && members.length >= 2 && members.every((j) => phones[j]?.mobile === true)
    const ownerGroupId = grouped && p ? ownerGroupIdFor(p.e164) : null
    if (grouped && members[0] === i) grupos += 1
    const next = { ...l, ...(p?.backfill ? { phoneE164: p.e164, phoneCountry: p.country, phoneMobile: p.mobile } : {}), ownerGroupId }
    const leadScore = computeLeadScore({ ...next, ownerGroupSize: grouped ? members.length : 1 })
    l.leadScore !== leadScore || l.ownerGroupId !== ownerGroupId || p?.backfill ? mudou++ : 0
    if (apply) {
      await prisma.prospect.update({ where: { id: l.id }, data: { ownerGroupId, leadScore, ...(p?.backfill ? { phoneE164: p.e164, phoneCountry: p.country, phoneMobile: p.mobile } : {}) } })
    }
    ;(l as { leadScore: number }).leadScore = leadScore // usado no top abaixo
  }
  console.log(`${mudou} lead(s) ${apply ? 'atualizado(s)' : 'seriam atualizados (use --apply)'} de ${leads.length}; ${grupos} grupo(s) de mesmo dono (só celular)`)
  const top = [...leads].sort((a, b) => b.leadScore - a.leadScore).slice(0, 10)
  console.table(top.map((l, i) => ({ '#': i + 1, lead: l.arenaName, score: l.leadScore, aval: l.numAvaliacoes, site: l.statusSite })))
}

main().catch((e) => { console.error(e); process.exitCode = 1 }).finally(() => prisma.$disconnect())
