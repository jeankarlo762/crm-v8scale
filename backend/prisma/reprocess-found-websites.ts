// Reaplica TODAS as regras de aceitação (blocklist, governo, agregador, similaridade, nome com a cidade,
// outro estado, mesmo site do Google) ao foundWebsite e ao instagramHandle já salvos, reclassifica o
// statusSite quando o websiteUri é de plataforma (blocklist) e recalcula o leadScore. O websiteUri que o
// dono cadastrou no Google nunca é removido. Campos manuais são preservados.
// Uso: tsx prisma/reprocess-found-websites.ts [--apply]   (sem --apply é simulação)
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { isBlockedDomain } from '../src/services/domain-classifier.service'
import { rejectFoundSite, rejectInstagramHandle } from '../src/services/found-site-rules.service'
import { classifySite } from '../src/services/site-kind.service'
import { computeLeadScore } from '../src/services/lead-score.service'

const prisma = new PrismaClient()
const apply = process.argv.includes('--apply')

function host(url: string): string | null {
  try { return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname } catch { return null }
}

async function main() {
  const leads = await prisma.prospect.findMany()
  const groupSize = new Map<string, number>()
  for (const l of leads) if (l.ownerGroupId) groupSize.set(l.ownerGroupId, (groupSize.get(l.ownerGroupId) ?? 0) + 1)
  const rows: Record<string, string>[] = []
  for (const l of leads) {
    let data: Record<string, unknown> = {}
    const motivos: string[] = []
    const ctx = { arenaName: l.arenaName, city: l.city, state: l.state, website: l.website, instagramHandle: l.instagramHandle }
    if (l.foundWebsite && !l.siteManual && l.foundWebsiteSource !== 'manual') {
      const m = rejectFoundSite(l.foundWebsite, ctx, { allowUnrelated: l.foundWebsiteSource === 'link_na_bio' || l.foundWebsiteSource === 'instagram' })
      if (m) {
        motivos.push(`site: ${m}`)
        data = { ...data, foundWebsite: null, foundWebsiteVerificar: false, foundSiteStatus: null, foundSiteCheckReason: null, foundWebsiteSource: null }
      }
    }
    if (l.instagramHandle && !l.instagramManual) {
      const m = rejectInstagramHandle(l.instagramHandle, ctx)
      if (m) {
        motivos.push(`@: ${m}`)
        data = { ...data, instagramHandle: null, instagramVerificar: false }
      }
    }
    // websiteUri de plataforma (blocklist) deixa de ser site próprio; o site do dono em si nunca é removido.
    const wh = l.website ? host(l.website) : null
    if (wh && l.statusSite === 'site_proprio' && isBlockedDomain(wh)) {
      data = { ...data, statusSite: classifySite(l.website).kind, siteStatus: null, siteCheckReason: null }
      motivos.push('websiteUri de plataforma')
    }
    if (motivos.length === 0) continue
    const next = { ...l, ...data } as typeof l
    const scoreNovo = computeLeadScore({ ...next, ownerGroupSize: next.ownerGroupId ? groupSize.get(next.ownerGroupId) ?? 1 : 1 })
    rows.push({ lead: l.arenaName, site: l.foundWebsite ?? '-', arroba: l.instagramHandle ?? '-', motivo: motivos.join(' + '), status: `${l.statusSite} -> ${next.statusSite}`, score: `${l.leadScore} -> ${scoreNovo}` })
    if (apply) await prisma.prospect.update({ where: { id: l.id }, data: { ...data, leadScore: scoreNovo } })
  }
  console.table(rows)
  console.log(`${rows.length} lead(s) ${apply ? 'atualizado(s)' : 'seriam atualizados (use --apply)'} de ${leads.length}`)
}

main().catch((e) => { console.error(e); process.exitCode = 1 }).finally(() => prisma.$disconnect())
