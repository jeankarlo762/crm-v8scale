import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const pause = vi.hoisted(() => ({ current: null as null | { reason: string } }))
vi.mock('./provider-state.service', () => ({ getProviderPause: async () => pause.current, listProviderStates: async () => [], pauseProvider: async () => {}, resumeProvider: async () => {} }))
vi.mock('../config/database', () => ({ prisma: {} }))

import { env } from '../config/env'
import { reconcileQuotaConfig, remainingBudget, reserve, setQuotaStore, MemoryQuotaStore, QuotaRun, getUsage, configBlock, currentBlock, _resetQuotaForTests, type QuotaStore } from './api-quota.service'

const KEYS = ['GOOGLE_TEXT_SEARCH_PRO', 'GOOGLE_PLACE_DETAILS_ENTERPRISE', 'TAVILY', 'META'].flatMap((p) => ['HOURLY', 'MONTHLY'].map((w) => `${p}_${w}_BUDGET`))
function budgets(b: Record<string, number>, safety = 0) {
  for (const k of KEYS) (env as Record<string, unknown>)[k] = undefined
  Object.assign(env, b, { API_QUOTA_SAFETY_PERCENT: safety, GOOGLE_TEXT_SEARCH_PRO_EXTERNAL_RESERVED: 0, TAVILY_EXTERNAL_RESERVED: 0, API_OPERATION_BUDGETS: undefined, API_QUOTA_ALLOW_ABOVE_DOCUMENTED_CAP: 'false' })
}
const T = { operation: 'SEARCH_BASIC' }

describe('api-quota: configuração obrigatória', () => {
  beforeEach(() => { _resetQuotaForTests(); setQuotaStore(new MemoryQuotaStore()); pause.current = null })

  it('sem orçamento obrigatório o provedor fica BLOQUEADO com motivo — nunca opera sem teto', async () => {
    budgets({})
    for (const p of ['GOOGLE_TEXT_SEARCH_PRO', 'TAVILY', 'META'] as const) {
      const r = await reserve(p, T)
      expect(r.ok).toBe(false)
      if (!r.ok) { expect(r.code).toBe('NOT_CONFIGURED'); expect(r.detail).toContain(p) }
    }
  })

  it('Meta exige apenas o limite por hora; só o mensal (opcional) não basta', async () => {
    budgets({ META_MONTHLY_BUDGET: 100 })
    const r = await reserve('META', T)
    expect(r.ok).toBe(false)
    if (!r.ok) { expect(r.code).toBe('NOT_CONFIGURED'); expect(r.detail).toContain('META_HOURLY_BUDGET'); expect(r.detail).not.toContain('DAILY') }
    budgets({ META_HOURLY_BUDGET: 10 })
    expect((await reserve('META', T)).ok).toBe(true)
  })

  it('API_OPERATION_BUDGETS com janela diária (D) é inválido: a janela diária não existe mais', async () => {
    budgets({ TAVILY_MONTHLY_BUDGET: 100 })
    ;(env as Record<string, unknown>).API_OPERATION_BUDGETS = JSON.stringify({ 'TAVILY:SEARCH_BASIC': { D: 2 } })
    const r = await reserve('TAVILY', T)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('INVALID_CONFIG')
  })

  it('orçamento acima da franquia gratuita documentada bloqueia; só libera com a flag explícita', async () => {
    budgets({ GOOGLE_TEXT_SEARCH_PRO_MONTHLY_BUDGET: 5001 }) // acima da franquia documentada do Text Search Pro (5.000)
    const r = await reserve('GOOGLE_TEXT_SEARCH_PRO', T)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('ABOVE_DOCUMENTED_CAP')
    ;(env as Record<string, unknown>).API_QUOTA_ALLOW_ABOVE_DOCUMENTED_CAP = 'true'
    expect((await reserve('GOOGLE_TEXT_SEARCH_PRO', T)).ok).toBe(true)
  })

  it('API_OPERATION_BUDGETS inválido bloqueia tudo (config quebrada não pode virar "sem teto")', async () => {
    budgets({ TAVILY_MONTHLY_BUDGET: 100 })
    ;(env as Record<string, unknown>).API_OPERATION_BUDGETS = '{nao-json'
    const r = await reserve('TAVILY', T)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('INVALID_CONFIG')
  })

  it('configBlock/currentBlock explicam o bloqueio sem consumir nada', async () => {
    budgets({})
    expect(configBlock('TAVILY')?.code).toBe('NOT_CONFIGURED')
    budgets({ TAVILY_MONTHLY_BUDGET: 10 })
    expect(configBlock('TAVILY')).toBeNull()
    expect(await currentBlock('TAVILY')).toBeNull()
  })
})

describe('api-quota: reserva atômica e fronteiras H/M', () => {
  let store: MemoryQuotaStore
  beforeEach(() => { _resetQuotaForTests(); store = new MemoryQuotaStore(); setQuotaStore(store); pause.current = null; vi.useFakeTimers() })
  afterEach(() => vi.useRealTimers())

  it('margem de segurança: 10 com 10% de reserva libera 9', async () => {
    budgets({ TAVILY_MONTHLY_BUDGET: 10 }, 10)
    let ok = 0
    for (let i = 0; i < 12; i++) if ((await reserve('TAVILY', T)).ok) ok++
    expect(ok).toBe(9)
  })

  it('consumo externo reservado é descontado da janela mensal', async () => {
    budgets({ TAVILY_MONTHLY_BUDGET: 10 })
    ;(env as Record<string, unknown>).TAVILY_EXTERNAL_RESERVED = 4
    let ok = 0
    for (let i = 0; i < 12; i++) if ((await reserve('TAVILY', T)).ok) ok++
    expect(ok).toBe(6)
  })

  it('workers concorrentes (30 ao mesmo tempo) nunca passam do teto', async () => {
    budgets({ TAVILY_MONTHLY_BUDGET: 10 })
    const rs = await Promise.all(Array.from({ length: 30 }, () => reserve('TAVILY', T)))
    expect(rs.filter((r) => r.ok)).toHaveLength(10)
  })

  it('Meta só com HOURLY opera: bloqueia ao passar do teto horário, informa quando volta e destrava na virada da hora', async () => {
    budgets({ META_HOURLY_BUDGET: 3 }) // sem mensal e sem diário: a hora é a única janela
    vi.setSystemTime(new Date('2026-10-05T10:59:59.000Z'))
    for (let i = 0; i < 3; i++) expect((await reserve('META', T)).ok).toBe(true)
    const blocked = await reserve('META', T)
    expect(blocked.ok).toBe(false)
    if (!blocked.ok) { expect(blocked.code).toBe('WINDOW_H'); expect(blocked.retryAt?.toISOString()).toBe('2026-10-05T11:00:00.000Z') }
    vi.setSystemTime(new Date('2026-10-05T11:00:00.000Z'))
    for (let i = 0; i < 3; i++) expect((await reserve('META', T)).ok).toBe(true) // a tentativa negada não consumiu; sem teto diário
    expect((await reserve('META', T)).ok).toBe(false)
    const u = await getUsage()
    expect(Object.keys(u.usage.META.janelas)).toEqual(['H', 'M'])
    expect(u.usage.META.janelas.H).toMatchObject({ usado: 3, orcamento: 3 })
    expect(u.usage.META.janelas.M.orcamento).toBeNull()
  })

  it('TAVILY_DAILY_BUDGET no ambiente não tem efeito (a janela diária não existe mais)', async () => {
    budgets({ TAVILY_MONTHLY_BUDGET: 100 })
    ;(env as Record<string, unknown>).TAVILY_DAILY_BUDGET = 1
    try {
      for (let i = 0; i < 5; i++) expect((await reserve('TAVILY', T)).ok).toBe(true)
      const u = await getUsage()
      expect(Object.keys(u.usage.TAVILY.janelas)).toEqual(['H', 'M'])
      expect(u.usage.TAVILY.janelas.M.usado).toBe(5)
      expect(configBlock('TAVILY')).toBeNull()
    } finally { delete (env as Record<string, unknown>).TAVILY_DAILY_BUDGET }
  })

  it('mês: reabre no 1º dia do mês seguinte e informa quando', async () => {
    budgets({ TAVILY_MONTHLY_BUDGET: 2 })
    vi.setSystemTime(new Date('2026-10-31T23:59:59.000Z'))
    expect((await reserve('TAVILY', T)).ok).toBe(true)
    expect((await reserve('TAVILY', T)).ok).toBe(true)
    const r = await reserve('TAVILY', T)
    expect(r.ok).toBe(false)
    if (!r.ok) { expect(r.code).toBe('WINDOW_M'); expect(r.retryAt?.toISOString()).toBe('2026-11-01T00:00:00.000Z') }
    vi.setSystemTime(new Date('2026-11-01T00:00:00.000Z'))
    expect((await reserve('TAVILY', T)).ok).toBe(true)
  })

  it('bloqueio por UMA janela não consome as outras (checa tudo, depois contabiliza)', async () => {
    budgets({ TAVILY_MONTHLY_BUDGET: 100, TAVILY_HOURLY_BUDGET: 1 })
    vi.setSystemTime(new Date('2026-10-05T10:00:00.000Z'))
    await reserve('TAVILY', T)
    await reserve('TAVILY', T) // bloqueada pela hora
    const u = await getUsage()
    expect(u.usage.TAVILY.janelas.H.usado).toBe(1)
    expect(u.usage.TAVILY.janelas.M.usado).toBe(1) // o mês NÃO foi incrementado pela tentativa negada
  })

  it('limite por execução: a execução para no teto sem gastar o orçamento do banco, e devolve só o slot da execução se o banco negar', async () => {
    budgets({ TAVILY_MONTHLY_BUDGET: 100, TAVILY_HOURLY_BUDGET: 2 })
    const run = new QuotaRun('t', { TAVILY: 3 })
    expect((await reserve('TAVILY', { ...T, run })).ok).toBe(true)
    expect((await reserve('TAVILY', { ...T, run })).ok).toBe(true)
    expect((await reserve('TAVILY', { ...T, run })).ok).toBe(false) // banco nega (hora=2): slot da execução volta
    expect(run.usedOf('TAVILY')).toBe(2)
    const run2 = new QuotaRun('t2', { TAVILY: 1 })
    const outro = await reserve('TAVILY', { ...T, run: run2 })
    expect(outro.ok).toBe(false) // hora já está no teto
    budgets({ TAVILY_MONTHLY_BUDGET: 100 })
    const run3 = new QuotaRun('t3', { TAVILY: 1 })
    expect((await reserve('TAVILY', { ...T, run: run3 })).ok).toBe(true)
    const r = await reserve('TAVILY', { ...T, run: run3 })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('RUN_LIMIT')
  })

  it('teto por operação: SEARCH_BASIC limitado sem afetar outra operação do mesmo provedor', async () => {
    budgets({ TAVILY_MONTHLY_BUDGET: 100 })
    ;(env as Record<string, unknown>).API_OPERATION_BUDGETS = JSON.stringify({ 'TAVILY:SEARCH_BASIC': { H: 2 } })
    expect((await reserve('TAVILY', T)).ok).toBe(true)
    expect((await reserve('TAVILY', T)).ok).toBe(true)
    const r = await reserve('TAVILY', T)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('OPERATION_LIMIT')
    expect((await reserve('TAVILY', { operation: 'OUTRA' })).ok).toBe(true)
  })

  it('armazenamento fora do ar = bloqueia (fail-closed), nunca libera sem contar', async () => {
    budgets({ TAVILY_MONTHLY_BUDGET: 100 })
    const boom = async (): Promise<never> => { throw new Error('db caiu') }
    const broken: QuotaStore = { tryReserve: boom, read: boom, getConfig: boom, initConfig: boom, hasUsage: boom, reconcile: boom }
    setQuotaStore(broken)
    const r = await reserve('TAVILY', T)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('STORE_ERROR')
  })

  it('provedor pausado (auth inválida) bloqueia até ser retomado', async () => {
    budgets({ TAVILY_MONTHLY_BUDGET: 100 })
    pause.current = { reason: 'chave inválida' }
    const r = await reserve('TAVILY', T)
    expect(r.ok).toBe(false)
    if (!r.ok) { expect(r.code).toBe('PROVIDER_PAUSED'); expect(r.detail).toContain('chave inválida') }
    pause.current = null
    expect((await reserve('TAVILY', T)).ok).toBe(true)
  })

  it('getUsage expõe consumo, saldo, bloqueio e as limitações (consumo externo não observável)', async () => {
    budgets({ TAVILY_MONTHLY_BUDGET: 10 }, 10)
    await reserve('TAVILY', T)
    const u = await getUsage()
    expect(u.usage.TAVILY.janelas.M).toMatchObject({ usado: 1, orcamento: 10, efetivo: 9, saldo: 8 })
    expect(u.usage.TAVILY.capGratuitoDocumentado).toBe(1000)
    expect(u.usage.GOOGLE_TEXT_SEARCH_PRO.configurado).toBe(false)
    expect(u.usage.GOOGLE_TEXT_SEARCH_PRO.bloqueio?.code).toBe('NOT_CONFIGURED')
    expect(u.limitacoes.join(' ')).toMatch(/externo/i)
  })
})

describe('api-quota: ciclo de reset configurado por provedor (nada presumido)', () => {
  const E = env as Record<string, unknown>
  const cycle = (p: 'GOOGLE_TEXT_SEARCH_PRO' | 'TAVILY' | 'META', reset: string | undefined, tz = 'UTC') => { const k = p.startsWith('GOOGLE') ? 'GOOGLE_PLACES' : p; E[`${k}_QUOTA_RESET`] = reset; E[`${k}_QUOTA_TZ`] = tz }
  const at = (iso: string) => vi.setSystemTime(new Date(iso))
  beforeEach(() => {
    _resetQuotaForTests(); setQuotaStore(new MemoryQuotaStore()); pause.current = null
    for (const p of ['GOOGLE_TEXT_SEARCH_PRO', 'TAVILY', 'META'] as const) cycle(p, 'FIXED')
    Object.assign(env, { GOOGLE_PLACES_QUOTA_SHARED: 'false', TAVILY_QUOTA_SHARED: 'false', GOOGLE_TEXT_SEARCH_PRO_PRIOR_USAGE: undefined, GOOGLE_TEXT_SEARCH_PRO_PRIOR_USAGE_UNTIL: undefined, TAVILY_PRIOR_USAGE: undefined, TAVILY_PRIOR_USAGE_UNTIL: undefined })
    vi.useFakeTimers({ toFake: ['Date'] })
  })
  afterEach(() => { vi.useRealTimers(); cycle('GOOGLE_TEXT_SEARCH_PRO', 'FIXED'); cycle('TAVILY', 'FIXED'); cycle('META', 'FIXED') })

  it('ciclo ausente, inválido ou com fuso inválido BLOQUEIA o provedor (nunca presume UTC/calendário)', async () => {
    budgets({ TAVILY_MONTHLY_BUDGET: 10 })
    cycle('TAVILY', undefined)
    let r = await reserve('TAVILY', T)
    expect(r.ok).toBe(false); if (!r.ok) { expect(r.code).toBe('INVALID_CONFIG'); expect(r.detail).toContain('TAVILY_QUOTA_RESET') }
    cycle('TAVILY', 'SEMANAL')
    r = await reserve('TAVILY', T); expect(r.ok).toBe(false)
    cycle('TAVILY', 'ANCHOR_DAY:31'); r = await reserve('TAVILY', T); expect(r.ok).toBe(false) // só 1-28
    cycle('TAVILY', 'FIXED', 'Marte/Olympus'); r = await reserve('TAVILY', T); expect(r.ok).toBe(false)
    budgets({ META_HOURLY_BUDGET: 5 }); cycle('META', 'ANCHOR_DAY:5')
    r = await reserve('META', { operation: 'BUSINESS_DISCOVERY' }); expect(r.ok).toBe(false) // âncora mensal não existe para a hora
  })

  it('FIXED com fuso: o mês vira à meia-noite LOCAL (America/Sao_Paulo = 03:00Z), não à meia-noite UTC', async () => {
    budgets({ TAVILY_MONTHLY_BUDGET: 1 }); cycle('TAVILY', 'FIXED', 'America/Sao_Paulo')
    at('2026-11-01T02:59:00Z') // ainda é outubro em São Paulo
    expect((await reserve('TAVILY', T)).ok).toBe(true)
    const blocked = await reserve('TAVILY', T)
    expect(blocked.ok).toBe(false)
    if (!blocked.ok) expect(blocked.retryAt?.toISOString()).toBe('2026-11-01T03:00:00.000Z')
    at('2026-11-01T03:00:00Z') // novembro em São Paulo
    expect((await reserve('TAVILY', T)).ok).toBe(true)
  })

  it('ANCHOR_DAY:15: o ciclo reinicia no dia 15 (00:00 do fuso) e o dia 14 ainda pertence ao ciclo anterior', async () => {
    budgets({ GOOGLE_TEXT_SEARCH_PRO_MONTHLY_BUDGET: 2 }); cycle('GOOGLE_TEXT_SEARCH_PRO', 'ANCHOR_DAY:15')
    const g = { operation: 'TEXT_SEARCH_PRO' }
    at('2026-10-01T12:00:00Z'); expect((await reserve('GOOGLE_TEXT_SEARCH_PRO', g)).ok).toBe(true) // ciclo 15/set → 14/out
    at('2026-10-14T23:59:00Z'); expect((await reserve('GOOGLE_TEXT_SEARCH_PRO', g)).ok).toBe(true)
    const b = await reserve('GOOGLE_TEXT_SEARCH_PRO', g)
    expect(b.ok).toBe(false); if (!b.ok) expect(b.retryAt?.toISOString()).toBe('2026-10-15T00:00:00.000Z')
    at('2026-10-15T00:00:00Z'); expect((await reserve('GOOGLE_TEXT_SEARCH_PRO', g)).ok).toBe(true) // ciclo novo
    expect((await getUsage()).usage.GOOGLE_TEXT_SEARCH_PRO.ciclo).toContain('ANCHOR_DAY:15')
  })

  it('ROLLING (limite móvel) mensal: política conservadora — o consumo só sai da soma depois de 30 dias inteiros', async () => {
    budgets({ TAVILY_MONTHLY_BUDGET: 3 }); cycle('TAVILY', 'ROLLING')
    at('2026-10-01T10:00:00Z'); expect((await reserve('TAVILY', T)).ok).toBe(true); expect((await reserve('TAVILY', T)).ok).toBe(true)
    at('2026-10-20T10:00:00Z'); expect((await reserve('TAVILY', T)).ok).toBe(true)
    at('2026-10-25T10:00:00Z'); expect((await reserve('TAVILY', T)).ok).toBe(false)
    at('2026-10-30T23:00:00Z'); expect((await reserve('TAVILY', T)).ok).toBe(false) // 1/out ainda dentro da janela de 30 dias
    at('2026-10-31T00:00:00Z'); expect((await reserve('TAVILY', T)).ok).toBe(true) // 1/out saiu: sobra 1 (a de 20/out ainda conta)
    expect((await reserve('TAVILY', T)).ok).toBe(true)
    expect((await reserve('TAVILY', T)).ok).toBe(false)
  })

  it('ROLLING por hora (Meta): 60 minutos móveis, não a hora cheia', async () => {
    budgets({ META_HOURLY_BUDGET: 2 }); cycle('META', 'ROLLING')
    const m = { operation: 'BUSINESS_DISCOVERY' }
    at('2026-10-01T10:00:30Z'); expect((await reserve('META', m)).ok).toBe(true); expect((await reserve('META', m)).ok).toBe(true)
    at('2026-10-01T10:59:59Z'); expect((await reserve('META', m)).ok).toBe(false) // virou a hora cheia? não: ainda dentro dos 60 min
    at('2026-10-01T11:01:00Z'); expect((await reserve('META', m)).ok).toBe(true) // 10:00 saiu da janela móvel
  })

  it('30 reservas simultâneas em limite móvel: exatamente o teto passa (soma de baldes sob concorrência)', async () => {
    budgets({ TAVILY_MONTHLY_BUDGET: 5, TAVILY_HOURLY_BUDGET: 4 }); cycle('TAVILY', 'ROLLING')
    at('2026-10-10T10:00:00Z')
    const rs = await Promise.all(Array.from({ length: 30 }, () => reserve('TAVILY', T)))
    expect(rs.filter((r) => r.ok)).toHaveLength(4) // a janela de 60 min (4) é a mais apertada
  })

  it('projeto compartilhado exige consumo externo explícito; informado, é descontado do mensal', async () => {
    budgets({ GOOGLE_TEXT_SEARCH_PRO_MONTHLY_BUDGET: 10 }); Object.assign(env, { GOOGLE_PLACES_QUOTA_SHARED: 'true', GOOGLE_TEXT_SEARCH_PRO_EXTERNAL_RESERVED: undefined })
    const g = { operation: 'TEXT_SEARCH_PRO' }
    const r = await reserve('GOOGLE_TEXT_SEARCH_PRO', g)
    expect(r.ok).toBe(false); if (!r.ok) { expect(r.code).toBe('INVALID_CONFIG'); expect(r.detail).toContain('GOOGLE_TEXT_SEARCH_PRO_EXTERNAL_RESERVED') }
    Object.assign(env, { GOOGLE_TEXT_SEARCH_PRO_EXTERNAL_RESERVED: 7 })
    const ok = await Promise.all(Array.from({ length: 6 }, () => reserve('GOOGLE_TEXT_SEARCH_PRO', g)))
    expect(ok.filter((x) => x.ok)).toHaveLength(3) // 10 − 7
  })

  it('contador novo NÃO ignora o consumo anterior: PRIOR_USAGE vale até PRIOR_USAGE_UNTIL e exige os dois campos', async () => {
    budgets({ TAVILY_MONTHLY_BUDGET: 10 })
    at('2026-10-10T10:00:00Z')
    Object.assign(env, { TAVILY_PRIOR_USAGE: 6, TAVILY_PRIOR_USAGE_UNTIL: '2026-11-01T00:00:00Z' })
    const first = await Promise.all(Array.from({ length: 8 }, () => reserve('TAVILY', T)))
    expect(first.filter((x) => x.ok)).toHaveLength(4) // 10 − 6 já gastos antes do contador
    Object.assign(env, { TAVILY_PRIOR_USAGE_UNTIL: undefined }) // metade da config: bloqueia, não presume zero
    const half = await reserve('TAVILY', T)
    expect(half.ok).toBe(false); if (!half.ok) expect(half.code).toBe('INVALID_CONFIG')
    Object.assign(env, { TAVILY_PRIOR_USAGE_UNTIL: '2026-11-01T00:00:00Z' })
    at('2026-11-01T00:00:01Z') // consumo anterior saiu da janela do provedor: o mês novo tem o orçamento cheio
    expect((await reserve('TAVILY', T)).ok).toBe(true)
  })
})

describe('api-quota: mudança de ciclo NÃO zera o consumo (CONFIG_CHANGED até reconciliar)', () => {
  const E = env as Record<string, unknown>
  const cycle = (p: 'GOOGLE_TEXT_SEARCH_PRO' | 'TAVILY' | 'META', reset: string | undefined, tz = 'UTC') => { const k = p.startsWith('GOOGLE') ? 'GOOGLE_PLACES' : p; E[`${k}_QUOTA_RESET`] = reset; E[`${k}_QUOTA_TZ`] = tz }
  let store: MemoryQuotaStore
  beforeEach(() => {
    _resetQuotaForTests(); store = new MemoryQuotaStore(); setQuotaStore(store); pause.current = null
    for (const p of ['GOOGLE_TEXT_SEARCH_PRO', 'TAVILY', 'META'] as const) cycle(p, 'FIXED')
    Object.assign(env, { TAVILY_PRIOR_USAGE: undefined, TAVILY_PRIOR_USAGE_UNTIL: undefined })
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-10T10:00:00Z'))
  })
  afterEach(() => { vi.useRealTimers(); for (const p of ['GOOGLE_TEXT_SEARCH_PRO', 'TAVILY', 'META'] as const) cycle(p, 'FIXED') })

  it('orçamento já consumido + mudança de QUOTA_RESET/fuso/âncora: bloqueia (não libera orçamento "novo"), histórico preservado', async () => {
    budgets({ TAVILY_MONTHLY_BUDGET: 3 })
    for (let i = 0; i < 3; i++) expect((await reserve('TAVILY', T)).ok).toBe(true) // mês esgotado no ciclo FIXED/UTC
    expect((await reserve('TAVILY', T)).ok).toBe(false)
    const antes = new Map(store.counts)
    for (const [reset, tz] of [['FIXED', 'America/Sao_Paulo'], ['ANCHOR_DAY:20', 'UTC'], ['ROLLING', 'UTC']] as const) {
      cycle('TAVILY', reset, tz) // com a chave nova o balde seria vazio e liberaria 3 chamadas
      const r = await reserve('TAVILY', T)
      expect(r.ok, `${reset}|${tz}`).toBe(false)
      if (!r.ok) { expect(r.code).toBe('CONFIG_CHANGED'); expect(r.detail).toContain('Bloqueado') }
      expect((await currentBlock('TAVILY'))?.code).toBe('CONFIG_CHANGED')
    }
    expect(store.counts).toEqual(antes) // nenhum consumo foi apagado nem acrescentado
  })

  it('mesmo ciclo reiniciado (mesma configuração) segue normal; só a DIFERENÇA bloqueia', async () => {
    budgets({ TAVILY_MONTHLY_BUDGET: 5 }); cycle('TAVILY', 'FIXED', 'America/Sao_Paulo')
    expect((await reserve('TAVILY', T)).ok).toBe(true)
    setQuotaStore(store) // "novo processo": o registro vem do armazenamento
    expect((await reserve('TAVILY', T)).ok).toBe(true)
  })

  it('primeiro uso com consumo legado (calendário UTC) e ciclo novo diferente: bloqueia; ciclo igual ao legado migra sem bloqueio', async () => {
    budgets({ TAVILY_MONTHLY_BUDGET: 5 })
    store.counts.set('TAVILY|M|2026-10', 4) // contador de antes do ciclo configurável (chaves FIXED/UTC)
    cycle('TAVILY', 'ANCHOR_DAY:15')
    const r = await reserve('TAVILY', T); expect(r.ok).toBe(false); if (!r.ok) expect(r.code).toBe('CONFIG_CHANGED')
    cycle('TAVILY', 'FIXED', 'UTC')
    expect((await reserve('TAVILY', T)).ok).toBe(true) // 5º; o contador legado (4) continuou valendo
    expect((await reserve('TAVILY', T)).ok).toBe(false)
  })

  it('reconciliação explícita: exige o consumo de cada janela obrigatória e uma nota; depois o contador respeita o declarado', async () => {
    budgets({ TAVILY_MONTHLY_BUDGET: 10 })
    for (let i = 0; i < 4; i++) await reserve('TAVILY', T)
    cycle('TAVILY', 'FIXED', 'America/Sao_Paulo')
    expect((await reserve('TAVILY', T)).ok).toBe(false)
    await expect(reconcileQuotaConfig('TAVILY', {}, 'console 10/10')).rejects.toThrow(/cada janela obrigatória/)
    await expect(reconcileQuotaConfig('TAVILY', { M: 4 }, ' ')).rejects.toThrow(/nota/)
    await reconcileQuotaConfig('TAVILY', { M: 7 }, 'Maria conferiu no console Tavily em 2026-10-10: 7 créditos usados no ciclo')
    const rs = await Promise.all(Array.from({ length: 6 }, () => reserve('TAVILY', T)))
    expect(rs.filter((x) => x.ok)).toHaveLength(3) // 10 − 7 declarados (o consumo antigo NÃO voltou a zero)
    const rec = await store.getConfig('TAVILY')
    expect(rec?.fingerprint).toBe('FIXED|America/Sao_Paulo')
    expect(rec?.history).toHaveLength(1) // histórico do ciclo anterior preservado
    expect(rec?.history[0]).toMatchObject({ fingerprint: 'FIXED|UTC' })
  })

  it('reconciliar com consumo MENOR que o já contado nunca reduz o contador (só aumenta)', async () => {
    budgets({ TAVILY_MONTHLY_BUDGET: 10 })
    for (let i = 0; i < 6; i++) await reserve('TAVILY', T)
    cycle('TAVILY', 'FIXED', 'UTC'); cycle('TAVILY', 'FIXED', 'America/Sao_Paulo')
    await reconcileQuotaConfig('TAVILY', { M: 2 }, 'declaração baixa')
    const rs = await Promise.all(Array.from({ length: 6 }, () => reserve('TAVILY', T)))
    expect(rs.filter((x) => x.ok)).toHaveLength(4) // o balde do novo ciclo parte de 2 (declarado), não de 0
  })

  it('limite móvel: reconciliação soma só o que falta ao balde de hoje', async () => {
    budgets({ TAVILY_MONTHLY_BUDGET: 6 })
    for (let i = 0; i < 2; i++) await reserve('TAVILY', T)
    cycle('TAVILY', 'ROLLING')
    expect((await reserve('TAVILY', T)).ok).toBe(false)
    await reconcileQuotaConfig('TAVILY', { M: 5 }, 'console')
    const rs = await Promise.all(Array.from({ length: 4 }, () => reserve('TAVILY', T)))
    expect(rs.filter((x) => x.ok)).toHaveLength(1)
  })

  it('Meta (só hora): mudança de ciclo exige o consumo da janela horária na reconciliação', async () => {
    budgets({ META_HOURLY_BUDGET: 5 })
    const m = { operation: 'BUSINESS_DISCOVERY' }
    expect((await reserve('META', m)).ok).toBe(true)
    cycle('META', 'ROLLING')
    expect((await reserve('META', m)).ok).toBe(false)
    await expect(reconcileQuotaConfig('META', {}, 'x')).rejects.toThrow(/cada janela obrigatória \(H\)/)
    await reconcileQuotaConfig('META', { H: 1 }, 'x')
    expect((await reserve('META', m)).ok).toBe(true)
  })
})

describe('Google: Text Search PRO e Place Details ENTERPRISE têm contadores, orçamentos e margens SEPARADOS', () => {
  const PRO = 'GOOGLE_TEXT_SEARCH_PRO' as const
  const DET = 'GOOGLE_PLACE_DETAILS_ENTERPRISE' as const
  const OPS = { [PRO]: { operation: 'TEXT_SEARCH_PRO' }, [DET]: { operation: 'PLACE_DETAILS_ENTERPRISE' } }
  let store: MemoryQuotaStore
  beforeEach(() => {
    _resetQuotaForTests(); store = new MemoryQuotaStore(); setQuotaStore(store); pause.current = null
    Object.assign(env, { GOOGLE_PLACES_QUOTA_RESET: 'FIXED', GOOGLE_PLACES_QUOTA_TZ: 'UTC', GOOGLE_PLACES_QUOTA_SHARED: 'false', GOOGLE_TEXT_SEARCH_PRO_PRIOR_USAGE: undefined, GOOGLE_TEXT_SEARCH_PRO_PRIOR_USAGE_UNTIL: undefined, GOOGLE_PLACE_DETAILS_ENTERPRISE_PRIOR_USAGE: undefined, GOOGLE_PLACE_DETAILS_ENTERPRISE_PRIOR_USAGE_UNTIL: undefined, GOOGLE_TEXT_SEARCH_PRO_EXTERNAL_RESERVED: 0, GOOGLE_PLACE_DETAILS_ENTERPRISE_EXTERNAL_RESERVED: 0 })
  })
  const cfg = (pro: number | undefined, det: number | undefined, safety = 10) => {
    for (const k of KEYS) (env as Record<string, unknown>)[k] = undefined
    Object.assign(env, { GOOGLE_TEXT_SEARCH_PRO_MONTHLY_BUDGET: pro, GOOGLE_PLACE_DETAILS_ENTERPRISE_MONTHLY_BUDGET: det, API_QUOTA_SAFETY_PERCENT: safety, API_OPERATION_BUDGETS: undefined, API_QUOTA_ALLOW_ABOVE_DOCUMENTED_CAP: 'false' })
  }
  const burst = async (p: typeof PRO | typeof DET, n: number) => { let ok = 0; for (let i = 0; i < n; i++) if ((await reserve(p, OPS[p])).ok) ok++; return ok }

  it('cada operação consome SÓ o próprio orçamento (usado/saldo independentes)', async () => {
    cfg(5000, 1000, 0)
    await burst(PRO, 120); await burst(DET, 7)
    const u = (await getUsage()).usage
    expect(u[PRO].janelas.M).toMatchObject({ usado: 120, orcamento: 5000, efetivo: 5000, saldo: 4880 })
    expect(u[DET].janelas.M).toMatchObject({ usado: 7, orcamento: 1000, efetivo: 1000, saldo: 993 })
  })

  it('5.000 buscas Pro NÃO liberam mais de 1.000 Details Enterprise (nem o contrário)', async () => {
    cfg(5000, 1000, 0)
    expect(await burst(PRO, 5200)).toBe(5000)
    expect(await burst(DET, 2500)).toBe(1000) // Pro esgotado não dá folga ao Details, e Details não passa de 1.000
    expect((await reserve(PRO, OPS[PRO])).ok).toBe(false)
    cfg(5000, 1000, 0); store.counts.clear()
    expect(await burst(DET, 1500)).toBe(1000)
    expect(await burst(PRO, 6000)).toBe(5000) // Details esgotado não consome o Pro
  })

  it('a margem de segurança é aplicada POR operação: 10% de 5.000 = 4.500 e 10% de 1.000 = 900', async () => {
    cfg(5000, 1000, 10)
    expect(await burst(PRO, 6000)).toBe(4500)
    expect(await burst(DET, 2000)).toBe(900)
    const u = (await getUsage()).usage
    expect(u[PRO].janelas.M.efetivo).toBe(4500); expect(u[DET].janelas.M.efetivo).toBe(900)
  })

  it('cada operação tem franquia documentada própria (Pro 5.000, Details 1.000): acima disso bloqueia', async () => {
    cfg(5001, 1000)
    expect((await reserve(PRO, OPS[PRO]))).toMatchObject({ ok: false, code: 'ABOVE_DOCUMENTED_CAP' })
    cfg(5000, 1001)
    expect((await reserve(DET, OPS[DET]))).toMatchObject({ ok: false, code: 'ABOVE_DOCUMENTED_CAP' })
  })

  it('cada operação exige o PRÓPRIO orçamento: configurar uma não libera a outra', async () => {
    cfg(5000, undefined)
    expect((await reserve(PRO, OPS[PRO])).ok).toBe(true)
    const r = await reserve(DET, OPS[DET])
    expect(r.ok).toBe(false); if (!r.ok) { expect(r.code).toBe('NOT_CONFIGURED'); expect(r.detail).toContain('GOOGLE_PLACE_DETAILS_ENTERPRISE_MONTHLY_BUDGET') }
    const u = (await getUsage()).usage
    expect(u[PRO].bloqueio).toBeNull(); expect(u[DET].bloqueio?.code).toBe('NOT_CONFIGURED')
  })

  it('limite por execução separado por operação (um clique não gasta tudo de uma vez)', async () => {
    cfg(5000, 1000, 0)
    const run = new QuotaRun('clique', { [PRO]: 3, [DET]: 2 })
    expect((await Promise.all(Array.from({ length: 8 }, () => reserve(PRO, { ...OPS[PRO], run })))).filter((r) => r.ok)).toHaveLength(3)
    expect((await Promise.all(Array.from({ length: 8 }, () => reserve(DET, { ...OPS[DET], run })))).filter((r) => r.ok)).toHaveLength(2)
  })

  it('consumo externo e consumo anterior são por operação', async () => {
    cfg(5000, 1000, 0)
    Object.assign(env, { GOOGLE_PLACE_DETAILS_ENTERPRISE_EXTERNAL_RESERVED: 400 })
    expect(await burst(DET, 2000)).toBe(600)
    expect(await burst(PRO, 6000)).toBe(5000) // o reservado do Details não encolhe o Pro
  })

  it('contador ANTIGO do Google (operação única) com consumo bloqueia as duas novas até reconciliar (não zera em silêncio)', async () => {
    cfg(5000, 1000, 0)
    store.counts.set('GOOGLE_PLACES|M|2026-10', 300)
    for (const p of [PRO, DET] as const) { const r = await reserve(p, OPS[p]); expect(r.ok).toBe(false); if (!r.ok) expect(r.code).toBe('CONFIG_CHANGED') }
    await reconcileQuotaConfig(DET, { M: 300 }, 'conferido no console: 300 eventos Enterprise no ciclo')
    await reconcileQuotaConfig(PRO, { M: 0 }, 'conferido no console: nenhum Pro')
    expect(await burst(DET, 2000)).toBe(700); expect(await burst(PRO, 6000)).toBe(5000)
  })

  it('remainingBudget: saldo atual da operação (menor janela) e null quando bloqueada', async () => {
    cfg(5000, 1000, 10)
    await burst(DET, 100)
    expect(await remainingBudget(DET)).toBe(800) // 900 efetivos − 100
    expect(await remainingBudget(PRO)).toBe(4500)
    cfg(5000, undefined); expect(await remainingBudget(DET)).toBeNull()
  })
})
