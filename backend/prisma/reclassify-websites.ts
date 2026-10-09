// Reclassifica a base existente com as regras novas, usando SOMENTE evidências já armazenadas (LeadEvidence + campos do lead).
// NÃO faz nenhuma chamada externa (nem Google, nem Tavily, nem Meta, nem HTTP): o fetch global é bloqueado de propósito.
// Lead legado sem evidência armazenada NÃO herda "sem site": vira UNKNOWN (investigação pendente) — é o efeito esperado
// das regras mais estritas, e o relatório mostra exatamente quantos e por quê.
//
// Uso:
//   tsx prisma/reclassify-websites.ts                       # SIMULAÇÃO (padrão): não grava nada
//   tsx prisma/reclassify-websites.ts --nicho <id> --limit 500 --out relatorio.json
//   tsx prisma/reclassify-websites.ts --apply --confirm-backup   # grava (decisão, cobertura, confirmação) — exige backup confirmado
//   ... --apply --confirm-backup --enqueue                  # e enfileira p/ investigação (sempre sob orçamento) quem ficou pendente
//   ... --apply --confirm-backup --keep-legacy --enqueue    # lead SEM evidência armazenada mantém a decisão antiga COMO HISTÓRICO (websiteOutcome=LEGACY):
//                                                            # ela NÃO autoriza campanha "só sem site" até uma investigação nova concluir com evidência vigente
// Preserva status comercial, responsável, notas, campanhas e histórico (confirmedWebsite vira histórico em websiteConfirmation).
import 'dotenv/config'
import { writeFileSync } from 'node:fs'
import { PrismaClient } from '@prisma/client'
import { dependsOnHash, type EvidenceRow, type EvidenceSource, type EvidenceType } from '../src/services/lead-evidence.service'
import { resolveFromEvidence } from '../src/services/website-resolve.service'
import { computeLeadScore, investigationPriority } from '../src/services/lead-score.service'
import { coverageJson, instagramShared, legacyConfirmation, nextConfirmation, toResolveLead, type ConfirmationRecord } from '../src/services/site-classify-queue.service'
import { CLASSIFIER_VERSION } from '../src/services/website-types'
import { ownerGroupSize } from '../src/services/owner-group.service'

// Garantia: nada aqui sai pela rede.
globalThis.fetch = (() => { throw new Error('reclassify-websites: chamadas externas são proibidas (somente evidências armazenadas)') }) as typeof fetch

const prisma = new PrismaClient()
const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined }
const has = (n: string) => process.argv.includes(`--${n}`)
const apply = has('apply')
if (apply && !has('confirm-backup')) { console.error('Recusado: --apply exige --confirm-backup (faça o backup do banco antes; veja DEPLOY-PROSPECCAO.md).'); process.exit(2) }

async function main() {
  const where = { ...(arg('nicho') ? { nichoId: arg('nicho') } : {}) }
  const take = arg('limit') ? Number(arg('limit')) : undefined
  const leads = await prisma.prospect.findMany({ where, orderBy: { createdAt: 'asc' }, ...(take ? { take } : {}) })
  const tavilyConfigured = !!process.env.TAVILY_API_KEY
  const metaConfigured = !!process.env.META_IG_BUSINESS_ID && !!process.env.META_ACCESS_TOKEN
  const matrix: Record<string, Record<string, number>> = {}
  const reasons: Record<string, number> = {}
  const pendingSteps: Record<string, number> = {}
  const changes: Record<string, unknown>[] = []
  let withEvidence = 0, wouldEnqueue = 0, applied = 0

  for (const l of leads) {
    const evRows = await prisma.leadEvidence.findMany({ where: { prospectId: l.id } })
    if (evRows.length) withEvidence++
    const rows: EvidenceRow[] = evRows.map((r) => ({ source: r.source as EvidenceSource, type: r.type as EvidenceType, key: r.key, value: r.value, outcome: r.outcome, fromCache: r.fromCache, collectedAt: r.collectedAt, dependsOn: r.dependsOn, version: r.version }))
    const owner = await ownerGroupSize(l)
    const res = resolveFromEvidence(toResolveLead(l, owner, await instagramShared(l)), rows, { dependsOn: dependsOnHash(l), tavilyConfigured, metaConfigured, exhausted: false })
    const d = res.decision
    const from = l.websiteStatus ?? 'SEM_DECISAO'
    ;(matrix[from] ??= {})[d.status] = ((matrix[from] ??= {})[d.status] ?? 0) + 1
    reasons[d.primaryReason] = (reasons[d.primaryReason] ?? 0) + 1
    const needsInvestigation = d.outcome !== 'FINAL'
    if (needsInvestigation) { wouldEnqueue++; for (const p of res.plan.filter((x) => !x.done && x.paid).slice(0, 1)) pendingSteps[p.action] = (pendingSteps[p.action] ?? 0) + 1 }
    const prev = (l.websiteConfirmation as ConfirmationRecord | null) ?? legacyConfirmation(l.confirmedWebsite)
    const confirmation = nextConfirmation(prev, d, new Date())
    const scoreNew = computeLeadScore({ ...l, websiteStatus: d.status, websiteConfidence: d.confidence, ownerGroupSize: owner })
    if (from !== d.status || l.leadScore !== scoreNew) changes.push({ lead: l.arenaName, de: from, para: d.status, motivo: d.primaryReason, confianca: d.confidence, score: `${l.leadScore} -> ${scoreNew}`, evidencias: evRows.length })
    if (apply && has('keep-legacy') && evRows.length === 0) {
      // decisão antiga preservada só como histórico (sem base para recalcular): LEGACY nunca é elegível para campanha "só sem site"
      await prisma.prospect.update({ where: { id: l.id }, data: { websiteOutcome: 'LEGACY', websiteValidUntil: null, ...(needsInvestigation && has('enqueue') ? { investigationState: 'PENDING', investigationNextRunAt: new Date(), investigationPriority: investigationPriority(l), investigationAttempts: 0 } : {}) } })
      continue
    }
    if (apply) {
      await prisma.prospect.update({
        where: { id: l.id },
        data: {
          websiteStatus: d.status, websiteConfidence: d.confidence, websiteReason: d.primaryReason, websiteDecidedAt: new Date(), classifierVersion: CLASSIFIER_VERSION,
          websiteOutcome: d.outcome, websiteValidUntil: d.validUntil ? new Date(d.validUntil) : null, // recalcular sem rede NÃO renova validade: ela vem da data real das evidências
          websiteEvidence: [...d.evidence, ...d.reasons.map((r) => ({ source: 'DECISION', type: 'REASON', value: r, confidence: 0 }))] as never,
          websiteCoverage: coverageJson(res, { exhausted: false, blocked: [], stats: { tavilyCalls: 0, metaCalls: 0, googleCalls: 0, pageFetches: 0, cacheHits: 0, iterations: 0 } }, new Date()) as never,
          websiteConfirmation: confirmation as never, leadScore: scoreNew,
          ...(needsInvestigation && has('enqueue') ? { investigationState: 'PENDING', investigationNextRunAt: new Date(), investigationPriority: investigationPriority(l), investigationAttempts: 0 } : {}),
        },
      })
      applied++
    }
  }

  const report = {
    modo: apply ? 'APLICADO' : 'SIMULAÇÃO (nada foi gravado)', classifier: CLASSIFIER_VERSION, leads: leads.length, comEvidenciaArmazenada: withEvidence, semEvidencia: leads.length - withEvidence,
    precisamInvestigar: wouldEnqueue, primeiraEtapaPaga: pendingSteps, deParaDecisao: matrix, motivos: reasons, alteracoes: changes.length, aplicados: applied,
    aviso: 'Leads sem evidência armazenada ficam UNKNOWN até serem investigados (sob orçamento). Confiança é heurística, não calibrada.',
  }
  console.log(JSON.stringify({ ...report, amostraAlteracoes: undefined }, null, 2))
  console.table(changes.slice(0, 40))
  if (changes.length > 40) console.log(`... e mais ${changes.length - 40} alteração(ões); use --out para o relatório completo`)
  if (arg('out')) { writeFileSync(arg('out') as string, JSON.stringify({ ...report, alteracoesDetalhe: changes }, null, 2)); console.log(`Relatório completo: ${arg('out')}`) }
  if (!apply) console.log('\nSIMULAÇÃO: nada foi gravado. Para gravar: --apply --confirm-backup (opcional --enqueue).')
}

main().catch((e) => { console.error(e); process.exitCode = 1 }).finally(() => prisma.$disconnect())
