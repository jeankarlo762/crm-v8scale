import { describe, it, expect, beforeEach } from 'vitest'
import { env } from '../config/env'
import { runInvestigation, progressFrom, backoffMs, type InvestigationDeps, type RunContext, type RunResult } from './investigation.service'
import { extractPageFacts } from './page-facts.service'
import { dependsOnHash, type EvidenceRow } from './lead-evidence.service'
import type { GuardedResult } from './api-guard.service'
import type { SearchResult } from './search-enrich.service'
import { LEAD, OWN_PAGE, OTHER_COMPANY_PAGE, hit, html } from './website-test-fixtures'
import type { ResolveLead } from './website-resolve.service'

const pages: Record<string, { html: string; httpStatus?: number | null; blocked?: boolean }> = {}
function setup(over: Partial<InvestigationDeps> = {}, lead: ResolveLead = LEAD) {
  const calls = { search: [] as string[], bio: [] as string[], fetch: [] as string[], links: [] as string[] }
  const saved: EvidenceRow[] = []
  let results: Record<string, SearchResult[]> = {}
  const deps: InvestigationDeps = {
    fetchFacts: async (url) => { calls.fetch.push(url); const p = pages[url] ?? { html: '', httpStatus: null }; return extractPageFacts({ url, finalUrl: url, html: p.html, httpStatus: p.httpStatus === undefined ? 200 : p.httpStatus, blocked: p.blocked }) },
    fetchLinks: async (u) => { calls.links.push(u); return { ok: true, links: [], instagram: null } },
    search: async (q): Promise<GuardedResult<SearchResult[]>> => { calls.search.push(q); return { status: 'OK', data: results[q] ?? [], fromCache: false, collectedAt: new Date(), outcome: 'POSITIVE' } },
    bio: async (h) => { calls.bio.push(h); return { status: 'OK' as const, data: { found: true, data: { username: h, website: null, followersCount: 10, mediaCount: 5, biography: 'quadras' } }, fromCache: false, collectedAt: new Date(), outcome: 'POSITIVE' as const } },
    google: async (placeId) => ({ status: 'OK' as const, data: { placeId, websiteUri: null, nationalPhone: null, internationalPhone: null, rating: null, userRatingCount: null, collection: 'place-details-enterprise:v1' }, fromCache: false, collectedAt: new Date(), outcome: 'NEGATIVE' as const }),
    save: async (row) => { saved.push(row) },
    now: () => new Date(),
    ...over,
  }
  const ctx = (o: Partial<RunContext> = {}): RunContext => ({ deps, dependsOn: dependsOnHash(lead), tavilyConfigured: true, metaConfigured: true, ...o })
  return { calls, saved, deps, ctx, setResults: (r: Record<string, SearchResult[]>) => { results = r }, run: (rows: EvidenceRow[] = [], o: Partial<RunContext> = {}) => runInvestigation(lead, rows, ctx(o)) }
}

beforeEach(() => { for (const k of Object.keys(pages)) delete pages[k]; Object.assign(env, { MAX_TAVILY_SEARCHES_PER_LEAD: 3 }) })

describe('investigação adaptativa: não consulta as três APIs para todo lead', () => {
  it('Google já confirmado pela página → nenhuma API paga é chamada', async () => {
    const l = { ...LEAD, website: 'https://arenatribo.com.br' }
    pages['https://arenatribo.com.br'] = { html: OWN_PAGE }
    const t = setup({}, l)
    const r = await t.run()
    expect(r.resolution.decision.status).toBe('HAS_WEBSITE')
    expect(t.calls.search).toHaveLength(0)
    expect(t.calls.bio).toHaveLength(0)
    expect(t.calls.fetch).toEqual(['https://arenatribo.com.br'])
  })

  it('para na 1ª consulta quando um candidato lido é confirmado — sem telefone e sem Meta', async () => {
    const t = setup()
    t.setResults({ 'Arena Tribo Tubarão SC': [hit('https://arenatribo.com.br/sobre'), hit('https://www.tripadvisor.com.br/x', 'Arena Tribo')] })
    pages['https://arenatribo.com.br'] = { html: OWN_PAGE }
    const r = await t.run()
    expect(r.resolution.decision).toMatchObject({ status: 'HAS_WEBSITE', confirmedWebsite: 'https://arenatribo.com.br' })
    expect(t.calls.search).toEqual(['Arena Tribo Tubarão SC'])
    expect(t.calls.bio).toHaveLength(0)
    expect(r.stats.tavilyCalls).toBe(1)
  })

  it('analisa todos os candidatos relevantes (não para no 1º lido)', async () => {
    const t = setup()
    t.setResults({ 'Arena Tribo Tubarão SC': [hit('https://arenatribo-hotel.com.br', 'Arena Tribo Hotel'), hit('https://arenatribo.com.br')] })
    pages['https://arenatribo-hotel.com.br'] = { html: OTHER_COMPANY_PAGE }
    pages['https://arenatribo.com.br'] = { html: OWN_PAGE }
    const r = await t.run()
    expect(r.resolution.decision.confirmedWebsite).toBe('https://arenatribo.com.br')
    expect(t.calls.fetch).toEqual(expect.arrayContaining(['https://arenatribo-hotel.com.br', 'https://arenatribo.com.br']))
  })

  it('sem nenhum candidato: só as consultas discriminantes (nome+cidade+UF e telefone) → PROBABLY_NO_WEBSITE; sem Meta (sem @)', async () => {
    const t = setup()
    const r = await t.run()
    expect(t.calls.search).toEqual(['Arena Tribo Tubarão SC', expect.stringContaining('(48) 99123-4567')])
    expect(t.calls.bio).toHaveLength(0)
    expect(r.resolution.decision.status).toBe('PROBABLY_NO_WEBSITE')
    expect(r.exhausted).toBe(true)
  })

  it('com @ confirmado e Meta disponível: a bio vem ANTES do Tavily e, achando o site, o Tavily nem roda', async () => {
    const l = { ...LEAD, instagramHandle: 'arenatribo', instagramVerificar: false }
    pages['https://arenatribo.com.br'] = { html: OWN_PAGE }
    const t = setup({ bio: async (h) => ({ status: 'OK' as const, data: { found: true, data: { username: h, website: 'https://arenatribo.com.br', followersCount: 1, mediaCount: 1, biography: '' } }, fromCache: false, collectedAt: new Date(), outcome: 'POSITIVE' as const }) }, l)
    const r = await t.run()
    expect(r.resolution.decision.status).toBe('HAS_WEBSITE')
    expect(t.calls.search).toHaveLength(0)
    expect(r.stats.metaCalls).toBe(1)
  })

  it('o teto de consultas por lead é respeitado (MAX_TAVILY_SEARCHES_PER_LEAD) — opcionais só entram se sobrar teto e houver dúvida', async () => {
    Object.assign(env, { MAX_TAVILY_SEARCHES_PER_LEAD: 2 })
    const t = setup()
    t.setResults({ 'Arena Tribo Tubarão SC': [hit('https://arenatribo.com.br')] })
    pages['https://arenatribo.com.br'] = { html: html('Home', '<p>Bem-vindo</p>') } // inconclusivo: segue a dúvida
    await t.run()
    expect(t.calls.search.length).toBeLessThanOrEqual(2)
  })

  it('não gera URLs por suposição: só busca páginas que vieram do Google, da busca, da bio ou do histórico', async () => {
    const t = setup()
    await t.run()
    expect(t.calls.fetch).toHaveLength(0)
  })
})

describe('cache, retomada e limites', () => {
  it('resultado vindo de cache é contado como cache (não como chamada) e guarda o instante REAL da coleta', async () => {
    const old = new Date(Date.now() - 3 * 86400_000)
    const t = setup({ search: async () => ({ status: 'OK', data: [], fromCache: true, collectedAt: old, outcome: 'NEGATIVE' }) })
    const r = await t.run()
    expect(r.stats.tavilyCalls).toBe(0)
    expect(r.stats.cacheHits).toBe(2)
    const row = t.saved.find((x) => x.type === 'SEARCH_RESULTS')!
    expect(row.fromCache).toBe(true)
    expect(row.collectedAt).toEqual(old)
  })

  it('retoma sem repetir etapas aproveitáveis: 2ª execução com as evidências da 1ª só faz o que faltou', async () => {
    let n = 0
    const t = setup({ search: async () => { n++; if (n === 2) return { status: 'BLOCKED', block: { code: 'WINDOW_M', detail: 'TAVILY sem orçamento (M: 1/1)', retryAt: new Date(Date.now() + 3600_000) } }; return { status: 'OK', data: [], fromCache: false, collectedAt: new Date(), outcome: 'NEGATIVE' } } })
    const first = await t.run()
    expect(first.blocked.map((b) => b.code)).toEqual(['WINDOW_M'])
    expect(first.resolution.decision.status).toBe('UNKNOWN') // cota esgotada ≠ sem site
    expect(first.exhausted).toBe(false)
    const t2 = setup()
    const second = await t2.run(first.rows)
    expect(t2.calls.search).toHaveLength(1) // só o telefone
    expect(t2.calls.search[0]).toContain('(48) 99123-4567')
    expect(second.resolution.decision.status).toBe('PROBABLY_NO_WEBSITE')
  })

  it('cota do Tavily esgotada mas Meta disponível: a Meta ainda roda; nada vira "sem site"', async () => {
    const l = { ...LEAD, instagramHandle: 'arenatribo', instagramVerificar: false }
    const t = setup({ search: async () => ({ status: 'BLOCKED', block: { code: 'WINDOW_M', detail: 'sem orçamento', retryAt: new Date(Date.now() + 86400_000) } }) }, l)
    const r = await t.run()
    expect(t.calls.bio).toHaveLength(1)
    expect(r.blocked.some((b) => b.code === 'WINDOW_M')).toBe(true)
    expect(r.resolution.decision.status).toBe('UNKNOWN')
  })

  it('force: refaz as etapas vencidas (refresh), passando refresh ao guard — o orçamento é decidido lá', async () => {
    const seen: (boolean | undefined)[] = []
    const t = setup({ search: async (_q, o) => { seen.push(o.refresh); return { status: 'OK', data: [], fromCache: false, collectedAt: new Date(), outcome: 'NEGATIVE' } } })
    await t.run([], { forceAt: new Date(Date.now() - 1000) })
    expect(seen.every((x) => x === true)).toBe(true)
  })

  it('páginas lidas por HTTP viram fatos compactos persistidos (sem HTML) e são reaproveitadas na 2ª execução', async () => {
    const l = { ...LEAD, website: 'https://arenatribo.com.br' }
    pages['https://arenatribo.com.br'] = { html: OWN_PAGE }
    const t = setup({}, l)
    const first = await t.run()
    const row = t.saved.find((x) => x.type === 'PAGE_FACTS')!
    expect(JSON.stringify(row.value)).not.toContain('<html')
    const t2 = setup({}, l)
    await t2.run(first.rows)
    expect(t2.calls.fetch).toHaveLength(0)
  })

  it('erro de rede ao ler a página vira "não avaliável" (HTTP grátis é retentado em 6h), nunca ausência', async () => {
    const l = { ...LEAD, website: 'https://arenatribo.com.br' }
    const t = setup({ fetchFacts: async () => { throw new Error('ECONNRESET') } }, l)
    const r = await t.run()
    expect(r.resolution.candidates[0].linkage).toBe('NOT_EVALUABLE')
    expect(r.resolution.decision.status).toBe('UNKNOWN')
  })
})

const run = (over: Partial<RunResult> & { status?: string; outcome?: string; reason?: string }): RunResult => ({
  resolution: { decision: { status: over.status ?? 'UNKNOWN', outcome: over.outcome ?? 'INCOMPLETE', primaryReason: over.reason ?? 'INSUFFICIENT_EVIDENCE' }, next: null } as unknown as RunResult['resolution'],
  rows: [], blocked: [], stats: { tavilyCalls: 0, metaCalls: 0, googleCalls: 0, pageFetches: 0, cacheHits: 0, iterations: 0 }, exhausted: false, ...over,
})
const b = (code: string, over: Record<string, unknown> = {}) => ({ step: 'TAVILY_NAME', code, retryAt: null, detail: `d ${code}`, transient: false, ...over })
const NOW = new Date('2026-10-05T12:00:00Z')

describe('andamento (separado da decisão)', () => {
  it('decisão final → DONE', () => {
    expect(progressFrom(run({ outcome: 'FINAL', status: 'PROBABLY_NO_WEBSITE' }), 3, NOW)).toMatchObject({ state: 'DONE', nextAction: null, nextRunAt: null, attempts: 0 })
  })
  it('cota esgotada → WAITING_QUOTA acordando no fim da janela, com o motivo (≠ revisão manual)', () => {
    const p = progressFrom(run({ blocked: [b('WINDOW_M', { retryAt: new Date('2026-10-06T00:00:00Z') })] }), 0, NOW)
    expect(p).toMatchObject({ state: 'WAITING_QUOTA', attempts: 0 })
    expect(p.nextRunAt?.toISOString()).toBe('2026-10-06T00:00:00.000Z')
    expect(p.waitReason).toContain('WINDOW_M')
  })
  it('erro técnico/rate limit → WAITING_RETRY com backoff exponencial e tentativas; esgotadas → MANUAL_REVIEW', () => {
    const rand = () => 0.5 // jitter neutro (1.0x)
    const t = (att: number) => progressFrom(run({ blocked: [b('API_ERROR', { transient: true })] }), att, NOW, 5, rand)
    expect(t(0)).toMatchObject({ state: 'WAITING_RETRY', attempts: 1 })
    const d = [0, 1, 2, 3].map((a) => t(a).nextRunAt!.getTime() - NOW.getTime())
    for (let i = 1; i < d.length; i++) expect(d[i]).toBeGreaterThan(d[i - 1])
    expect(t(4)).toMatchObject({ state: 'MANUAL_REVIEW', nextRunAt: null })
    expect(t(4).waitReason).toContain('RETRIES_EXHAUSTED')
  })
  it('backoff tem teto e jitter limitado', () => {
    expect(backoffMs(30, 60, () => 0.5)).toBeLessThanOrEqual(6 * 3600_000)
    expect(backoffMs(1, 60, () => 0)).toBe(48_000)
    expect(backoffMs(1, 60, () => 1)).toBe(72_000)
  })
  it('auth inválida (provedor pausado) → WAITING_RETRY de 1h SEM consumir tentativas', () => {
    const p = progressFrom(run({ blocked: [b('PROVIDER_PAUSED')] }), 2, NOW)
    expect(p).toMatchObject({ state: 'WAITING_RETRY', attempts: 2 })
    expect(p.waitReason).toContain('PROVIDER_PAUSED')
    expect(p.nextRunAt!.getTime() - NOW.getTime()).toBe(3600_000)
  })
  it('integração sem configuração/acima do teto documentado → espera visível (WAITING_QUOTA), retoma sozinha quando configurar', () => {
    expect(progressFrom(run({ blocked: [b('NOT_CONFIGURED')] }), 0, NOW).state).toBe('WAITING_QUOTA')
    expect(progressFrom(run({ blocked: [b('ABOVE_DOCUMENTED_CAP')] }), 0, NOW).waitReason).toContain('ABOVE_DOCUMENTED_CAP')
  })
  it('investigação esgotada e ambígua → MANUAL_REVIEW (distinto de aguardando cota)', () => {
    const p = progressFrom(run({ outcome: 'NEEDS_REVIEW', exhausted: true, reason: 'CANDIDATE_INCONCLUSIVE' }), 0, NOW)
    expect(p).toMatchObject({ state: 'MANUAL_REVIEW', waitReason: 'CANDIDATE_INCONCLUSIVE' })
  })
  it('parou no limite de iterações sem bloqueio → volta logo (PENDING), nada se perde', () => {
    expect(progressFrom(run({}), 0, NOW).state).toBe('PENDING')
  })
})

describe('limites da rodada não viram "sem evidência"', () => {
  it('estourou o limite de páginas lidas: o restante fica pendente (volta logo) e a investigação NÃO é dada como esgotada', async () => {
    const urls = ['https://arenatribo.com.br', 'https://arenatribo.com', 'https://arenatribo.net']
    const l = { ...LEAD, website: urls[0], foundWebsite: urls[1], confirmedWebsite: urls[2] }
    for (const u of urls) pages[u] = { html: html('Home', '<p>Bem-vindo</p>') }
    const t = setup({}, l)
    const r = await t.run([], { maxPageFetches: 1 })
    expect(t.calls.fetch).toHaveLength(1)
    expect(r.blocked.some((b) => b.code === 'RUN_LIMIT')).toBe(true)
    expect(r.exhausted).toBe(false)
    const p = progressFrom(r, 0, new Date())
    expect(['WAITING_QUOTA', 'PENDING']).toContain(p.state)
    expect(p.state).not.toBe('MANUAL_REVIEW')
  })
})

// ── Revisão: Google com proveniência, páginas internas, Meta não suportada, lease perdida ────────────────────────
import { LeaseLostError } from './investigation.service'
import { googleRow } from './website-test-fixtures'

describe('Google: evidência com proveniência', () => {
  it('Google vindo de CACHE é gravado com a data REAL da resposta e fromCache=true (nunca "agora")', async () => {
    const coletado = new Date(Date.now() - 20 * 86_400_000)
    const t = setup({ google: async (placeId) => ({ status: 'OK' as const, data: { placeId, websiteUri: null, nationalPhone: null, internationalPhone: null, rating: null, userRatingCount: null, collection: 'place-details-enterprise:v1' }, fromCache: true, collectedAt: coletado, outcome: 'NEGATIVE' as const }) })
    const r = await t.run()
    const row = t.saved.find((x) => x.source === 'GOOGLE')
    expect(row).toMatchObject({ type: 'PLACE_FIELDS', key: 'place-1', fromCache: true, version: 'place-details-enterprise:v1' })
    expect(row?.collectedAt.getTime()).toBe(coletado.getTime())
    expect(r.stats.cacheHits).toBeGreaterThanOrEqual(1)
    expect(r.stats.googleCalls).toBe(0)
  })

  it('evidência vigente já presente: NENHUMA chamada adicional ao Google', async () => {
    let googleCalls = 0
    const t = setup({ google: async (placeId) => { googleCalls++; return { status: 'NOT_CONFIGURED' as const, placeId } as never } })
    const r = await t.run([googleRow()])
    expect(googleCalls).toBe(0)
    expect(r.resolution.decision.outcome).toBe('FINAL')
  })

  it('Google bloqueado por cota: a etapa fica pendente (nunca "sem site") e sem evidência gravada', async () => {
    const t = setup({ google: async () => ({ status: 'BLOCKED' as const, block: { code: 'WINDOW_M' as const, detail: 'GOOGLE_PLACES sem orçamento', retryAt: new Date(Date.now() + 3600_000) } }) })
    const r = await t.run()
    expect(r.resolution.decision.status).toBe('UNKNOWN')
    expect(r.blocked[0]).toMatchObject({ step: 'GOOGLE_DETAILS', code: 'WINDOW_M' })
    expect(t.saved.some((x) => x.source === 'GOOGLE')).toBe(false)
    expect(r.resolution.coverage.sources.GOOGLE).toBe('NOT_CHECKED_QUOTA')
  })
})

describe('Meta não suportada: a cobertura alternativa é EXECUTADA, não fingida', () => {
  it('bio NOT_FOUND → busca pelo @ roda e a conclusão sai sem bônus de bio', async () => {
    const ig = { ...LEAD, instagramHandle: 'arenatribo', instagramVerificar: false }
    const t = setup({ bio: async () => ({ status: 'OK' as const, data: { found: false, data: null }, fromCache: false, collectedAt: new Date(), outcome: 'NEGATIVE' as const }) }, ig)
    const r = await t.run()
    expect(t.calls.search.some((q) => q === '"arenatribo"')).toBe(true)
    expect(r.resolution.decision).toMatchObject({ status: 'SOCIAL_ONLY', outcome: 'FINAL' })
    expect(r.resolution.decision.reasons).not.toContain('INSTAGRAM_BIO_WITHOUT_SITE')
  })
})

describe('páginas internas lidas por HTTP grátis', () => {
  const l = { ...LEAD, website: 'https://arenatribo.com.br' }
  it('home acessível mas insuficiente → lê /contato (prioridade) e confirma; para sem ler as demais', async () => {
    pages['https://arenatribo.com.br'] = { html: html('Arena Tribo', '<a href="/contato">Contato</a><a href="/sobre">Sobre</a>') }
    pages['https://arenatribo.com.br/contato'] = { html: html('Contato', '<footer>Contato: (48) 99123-4567</footer>') }
    pages['https://arenatribo.com.br/sobre'] = { html: html('Sobre', '<p>Nossa história</p>') }
    const t = setup({}, l)
    const r = await t.run([googleRow({ lead: l, websiteUri: 'https://arenatribo.com.br' })])
    expect(r.resolution.decision).toMatchObject({ status: 'HAS_WEBSITE', confirmedWebsite: 'https://arenatribo.com.br' })
    expect(t.calls.fetch).toEqual(['https://arenatribo.com.br', 'https://arenatribo.com.br/contato']) // /sobre nem foi lida
    expect(t.calls.search).toHaveLength(0) // sem nenhuma consulta paga
  })

  it('limite de páginas por rodada: não é prova negativa — fica pendente e retoma depois', async () => {
    pages['https://arenatribo.com.br'] = { html: html('Arena Tribo', '<a href="/contato">Contato</a><a href="/sobre">Sobre</a>') }
    pages['https://arenatribo.com.br/contato'] = { html: html('Contato', '<p>Fale com a gente</p>') }
    const t = setup({}, l)
    const r = await t.run([googleRow({ lead: l, websiteUri: 'https://arenatribo.com.br' })], { maxPageFetches: 2 })
    expect(r.stats.pageFetches).toBe(2)
    expect(r.blocked.some((b) => b.code === 'RUN_LIMIT')).toBe(true)
    expect(r.resolution.decision.status).not.toBe('PROBABLY_NO_WEBSITE')
  })
})

describe('lease perdida: nenhuma nova chamada externa', () => {
  it('claim perdido entre etapas interrompe a investigação com LeaseLostError, sem novas chamadas e sem gravar mais', async () => {
    let active = true
    const t = setup({ search: async (q) => { t.calls.search.push(q); active = false; return { status: 'OK' as const, data: [], fromCache: false, collectedAt: new Date(), outcome: 'NEGATIVE' as const } } })
    await expect(t.run([googleRow()], { isActive: () => active })).rejects.toBeInstanceOf(LeaseLostError)
    expect(t.calls.search).toHaveLength(1) // a 2ª consulta (telefone) NÃO foi feita
    expect(t.calls.bio).toHaveLength(0)
  })
})
