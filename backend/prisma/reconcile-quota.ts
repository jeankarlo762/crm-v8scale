// Reconciliação EXPLÍCITA do consumo depois de mudar *_QUOTA_RESET / *_QUOTA_TZ / âncora (o provedor fica bloqueado com
// CONFIG_CHANGED até isto). Nada é presumido: informe o consumo do ciclo ATUAL de cada janela obrigatória, conferido no
// console do provedor, e uma nota (quem/onde/quando). O contador nunca diminui; o ciclo anterior fica em ApiQuotaConfig.history.
//   tsx prisma/reconcile-quota.ts --provider TAVILY --used M=700 --note "Maria, console Tavily, 2026-10-10"
//   tsx prisma/reconcile-quota.ts --provider META --used H=12 --note "..."
import 'dotenv/config'
import { reconcileQuotaConfig, PROVIDERS, type Provider, type Window } from '../src/services/api-quota.service'
import { prisma } from '../src/config/database'

const args = process.argv.slice(2)
const all = (n: string) => args.flatMap((a, i) => (a === `--${n}` ? [args[i + 1]] : []))
const provider = all('provider')[0] as Provider
const note = all('note')[0] ?? ''
const used: Partial<Record<Window, number>> = {}
for (const kv of all('used')) { const [w, n] = kv.split('='); used[w as Window] = Number(n) }

async function main() {
  if (!PROVIDERS.includes(provider)) throw new Error(`--provider deve ser um de ${PROVIDERS.join(', ')}`)
  const r = await reconcileQuotaConfig(provider, used, note)
  console.log(`Reconciliado ${provider}: ciclo ${r.fingerprint}, consumo declarado ${JSON.stringify(r.applied)}`)
}
main().catch((e) => { console.error(e.message); process.exitCode = 1 }).finally(() => prisma.$disconnect())
