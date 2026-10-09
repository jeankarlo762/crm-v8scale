// Avaliação da classificação "tem site?" (ver src/services/website-eval.service.ts). Nenhuma chamada externa.
//   tsx prisma/eval-website-decision.ts --seed                       # roda os exemplos SINTÉTICOS (regressão; não mede desempenho real)
//   tsx prisma/eval-website-decision.ts --cases meus-casos.json      # casos rotulados no formato EvalCase[]
//   tsx prisma/eval-website-decision.ts --export-sample 100 --out amostra.json [--nicho ID]
//        exporta leads reais (com as evidências armazenadas) com truth:null — rotule truth = "HAS_WEBSITE" | "NO_WEBSITE" à mão
//   tsx prisma/eval-website-decision.ts --cases amostra.json --out relatorio.json    # métricas só dos casos rotulados
//   tsx prisma/eval-website-decision.ts --export-seed seed.json      # grava os exemplos sintéticos como modelo do formato
import 'dotenv/config'
import { readFileSync, writeFileSync } from 'node:fs'
import { PrismaClient } from '@prisma/client'
import { evaluate, fmtRate, type EvalCase } from '../src/services/website-eval.service'
import { SEED_CASES } from '../src/services/website-eval-seed'
import { toResolveLead } from '../src/services/site-classify-queue.service'
import { ownerGroupSize } from '../src/services/owner-group.service'

globalThis.fetch = (() => { throw new Error('eval-website-decision: chamadas externas são proibidas') }) as typeof fetch
const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined }
const has = (n: string) => process.argv.includes(`--${n}`)

function report(cases: EvalCase[], out?: string) {
  const { metrics, results, syntheticOnly } = evaluate(cases)
  console.log(syntheticOnly ? '\n*** CASOS SINTÉTICOS: serve para testar a rotina, NÃO é medida de desempenho real ***' : '')
  console.log(`Casos: ${metrics.total} (rotulados: ${metrics.labeled})  — ${metrics.note}`)
  console.log(`Falso positivo de site (disse "tem", não tem):   ${fmtRate(metrics.falsePositiveSite)}`)
  console.log(`Falso "sem site" (liberado, mas tem site):        ${fmtRate(metrics.falseNoSite)}`)
  console.log(`Precisão dos liberados p/ abordagem:              ${fmtRate(metrics.releasedPrecision)}`)
  console.log(`Recall de "sem site":                             ${fmtRate(metrics.recallNoSite)}`)
  console.log(`Resolvido automaticamente:                        ${fmtRate(metrics.autoResolved)}`)
  console.log(`Enviado à revisão manual (UNKNOWN/CONFLICT):      ${fmtRate(metrics.manualReview)}`)
  console.log(`Consumo por lead resolvido (Tavily+Meta):         ${metrics.callsPerResolved.perResolved == null ? 'n/d (sem dado de consumo nos casos)' : `${metrics.callsPerResolved.perResolved.toFixed(2)} chamadas (${metrics.callsPerResolved.leadsWithCallData} leads)`}`)
  console.table(metrics.confusion)
  console.table(results.map((r) => ({ id: r.case.id, verdade: r.case.truth ?? '(sem rótulo)', decisao: r.prediction.status, motivo: r.prediction.reason, confianca: r.prediction.confidence })))
  if (out) { writeFileSync(out, JSON.stringify({ metrics, previsoes: results.map((r) => r.prediction) }, null, 2)); console.log(`Relatório: ${out}`) }
}

async function main() {
  if (has('export-seed')) { writeFileSync(arg('export-seed') as string, JSON.stringify(SEED_CASES.map(({ expectStatus: _e, ...c }) => c), null, 2)); console.log('Modelo gravado.'); return }
  if (has('seed')) return report(SEED_CASES, arg('out'))
  if (arg('cases')) return report(JSON.parse(readFileSync(arg('cases') as string, 'utf8')) as EvalCase[], arg('out'))
  if (arg('export-sample')) {
    const prisma = new PrismaClient()
    try {
      const n = Number(arg('export-sample'))
      const all = await prisma.prospect.findMany({ where: { ...(arg('nicho') ? { nichoId: arg('nicho') } : {}) }, select: { id: true }, take: 5000 })
      const pick = all.sort(() => Math.random() - 0.5).slice(0, n)
      const cases: EvalCase[] = []
      for (const { id } of pick) {
        const l = await prisma.prospect.findUniqueOrThrow({ where: { id } })
        const rows = await prisma.leadEvidence.findMany({ where: { prospectId: id } })
        const cov = l.websiteCoverage as { calls?: { tavily?: number; meta?: number } } | null
        cases.push({
          id: l.id, note: `${l.arenaName} — decisão atual: ${l.websiteStatus ?? 'sem'}`, lead: toResolveLead(l, await ownerGroupSize(l)),
          rows: rows.map((r) => ({ row: { source: r.source, type: r.type, key: r.key, value: r.value, outcome: r.outcome, fromCache: r.fromCache, collectedAt: r.collectedAt.toISOString(), dependsOn: r.dependsOn, version: r.version } as never })),
          truth: null, ...(cov?.calls ? { calls: cov.calls } : {}),
        })
      }
      writeFileSync(arg('out') ?? 'amostra-avaliacao.json', JSON.stringify(cases, null, 2))
      console.log(`${cases.length} caso(s) exportado(s) com truth:null — rotule "HAS_WEBSITE" ou "NO_WEBSITE" e rode --cases.`)
    } finally { await prisma.$disconnect() }
    return
  }
  console.log('Use --seed, --cases <arquivo>, --export-sample <n> ou --export-seed <arquivo>. Veja o cabeçalho do arquivo.')
}

main().catch((e) => { console.error(e); process.exitCode = 1 })
