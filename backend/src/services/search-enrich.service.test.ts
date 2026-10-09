import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../config/database', () => ({ prisma: {} }))
vi.mock('./provider-state.service', () => ({ getProviderPause: async () => null, listProviderStates: async () => [], pauseProvider: vi.fn(async () => {}), resumeProvider: async () => {} }))

import { env } from '../config/env'
import { extractFromResults, extractSiteByHandle, mentionsBusiness, searchTavily, TavilyProvider, TAVILY_PARAMS, _setSearchProviderForTests, type SearchResult } from './search-enrich.service'
import { MemoryQuotaStore, setQuotaStore, getUsage, _resetQuotaForTests } from './api-quota.service'
import { MemoryCacheStore, setCacheStore, ProviderAuthError, ProviderRateLimitError, ProviderPlanLimitError } from './api-guard.service'

// Formato de results[] do Tavily: title, url, content.
const bombinhas = { city: 'Bombinhas', state: 'SC', address: 'Rua das Gaivotas, 10 - Bombas, Bombinhas - SC, 88215-000' }

const mock: SearchResult[] = [
  { title: 'Pousada Baiuka - Booking.com', url: 'https://www.booking.com/hotel/br/baiuka.html', content: 'Pousada Baiuka em Bombinhas' },
  { title: 'Pousada Baiuka - Tripadvisor', url: 'https://www.tripadvisor.com.br/Hotel_Review-baiuka', content: 'Baiuka pousada Bombinhas' },
  { title: 'Pousada Baiuka em Curitiba', url: 'https://instagram.com/baiuka_curitiba', content: 'Outra cidade, Curitiba - PR' },
  { title: 'Baiuka Pousada (@pousadabaiuka) • Instagram', url: 'https://www.instagram.com/p/Cabc123/', content: 'Post da Baiuka Pousada' },
  { title: 'Baiuka Pousada (@pousadabaiuka) • Instagram', url: 'https://www.instagram.com/pousadabaiuka/', content: 'Baiuka Pousada em Bombinhas' },
  { title: 'Baiuka Pousada | Bombinhas SC', url: 'https://baiukapousada.com.br/quartos', content: 'Reserve na Baiuka Pousada em Bombinhas' },
  { title: 'Baiuka Pousada links', url: 'https://linktr.ee/baiuka', content: 'Baiuka Pousada Bombinhas' },
]

describe('extractFromResults', () => {
  it('pega o Instagram e o domínio próprio confirmados pela cidade, ignorando OTAs, agregadores e /p/', () => {
    expect(extractFromResults(mock, 'Baiuka Pousada', bombinhas)).toMatchObject({
      instagramHandle: 'pousadabaiuka',
      foundWebsite: 'https://baiukapousada.com.br',
      bioUrl: 'https://linktr.ee/baiuka',
      instagramVerificar: false,
      foundWebsiteVerificar: false,
    })
  })

  it('homônimo em outra cidade ("Baiuka em Curitiba") vira sugestão "verificar", nunca confirmado', () => {
    const r = extractFromResults([mock[2]], 'Baiuka Pousada', bombinhas)
    expect(r.instagramHandle).toBe('baiuka_curitiba')
    expect(r.instagramVerificar).toBe(true)
  })

  it('exige o nome do negócio no título ou conteúdo', () => {
    const r = extractFromResults([{ title: 'Hotel Sol Nascente', url: 'https://solnascente.com.br', content: 'Hotel em Bombinhas' }], 'Baiuka Pousada', bombinhas)
    expect(r).toMatchObject({ instagramHandle: null, foundWebsite: null, bioUrl: null })
  })

  it('normaliza acento e caixa na cidade', () => {
    const r = extractFromResults(
      [{ title: 'Pousada Sol', url: 'https://pousadasol.com.br', content: 'Pousada Sol em FLORIANÓPOLIS' }],
      'Pousada Sol',
      { city: 'Florianópolis', state: 'SC' },
    )
    expect(r.foundWebsite).toBe('https://pousadasol.com.br')
    expect(r.foundWebsiteVerificar).toBe(false)
  })
})

describe('homônimo dentro do mesmo estado (Pousada Genoveva)', () => {
  const results: SearchResult[] = [
    { title: 'Pousada Genoveva (@genoveva_floripa) • Instagram', url: 'https://www.instagram.com/genoveva_floripa/', content: 'Pousada Genoveva em Florianópolis, SC' },
    { title: 'Pousada Genoveva | Florianópolis SC', url: 'https://genovevafloripa.com.br', content: 'Pousada Genoveva Florianópolis - SC' },
    { title: 'Pousada Genoveva (@pousadagenoveva_laguna) • Instagram', url: 'https://www.instagram.com/pousadagenoveva_laguna/', content: 'Pousada Genoveva, Laguna - Santa Catarina' },
    { title: 'Pousada Genoveva Laguna', url: 'https://pousadagenoveva.com.br', content: 'Pousada Genoveva em Laguna' },
  ]

  it('lead em Laguna fica com o perfil e o site de Laguna, confirmados', () => {
    const r = extractFromResults(results, 'Pousada Genoveva', { city: 'Laguna', state: 'SC' })
    expect(r).toMatchObject({
      instagramHandle: 'pousadagenoveva_laguna', instagramVerificar: false,
      foundWebsite: 'https://pousadagenoveva.com.br', foundWebsiteVerificar: false,
    })
  })

  it('se só existir o de Florianópolis, o lead de Laguna recebe só sugestão "verificar"', () => {
    const r = extractFromResults(results.slice(0, 2), 'Pousada Genoveva', { city: 'Laguna', state: 'SC' })
    expect(r.instagramHandle).toBe('genoveva_floripa')
    expect(r.instagramVerificar).toBe(true)
    expect(r.foundWebsite).toBe('https://genovevafloripa.com.br')
    expect(r.foundWebsiteVerificar).toBe(true)
  })

  it('dois perfis com a cidade no snippet = empate -> verificar', () => {
    const r = extractFromResults(
      [
        { title: 'Pousada Genoveva', url: 'https://instagram.com/genoveva_a', content: 'Pousada Genoveva Laguna' },
        { title: 'Pousada Genoveva', url: 'https://instagram.com/genoveva_b', content: 'Pousada Genoveva Laguna' },
      ],
      'Pousada Genoveva',
      { city: 'Laguna', state: 'SC' },
    )
    expect(r.instagramHandle).toBe('genoveva_a')
    expect(r.instagramVerificar).toBe(true)
  })
})

describe('cidade via addressComponents do Places', () => {
  const components = [
    { longText: '100', shortText: '100', types: ['street_number'] },
    { longText: 'Rua das Flores', shortText: 'R. das Flores', types: ['route'] },
    { longText: 'Mar Grosso', shortText: 'Mar Grosso', types: ['sublocality_level_1', 'sublocality', 'political'] },
    { longText: 'Laguna', shortText: 'Laguna', types: ['administrative_area_level_2', 'political'] },
    { longText: 'Santa Catarina', shortText: 'SC', types: ['administrative_area_level_1', 'political'] },
  ]
  const result: SearchResult[] = [{ title: 'Pousada Sol', url: 'https://pousadasol.com.br', content: 'Pousada Sol no bairro Mar Grosso' }]

  it('bairro (componente) confirma mesmo sem a cidade exibida no card', () => {
    const r = extractFromResults(result, 'Pousada Sol', { city: 'Tubarão', state: 'SC', addressComponents: components })
    expect(r.foundWebsiteVerificar).toBe(false)
  })

  it('formattedAddress também conta', () => {
    const r = extractFromResults(result, 'Pousada Sol', { city: 'Tubarão', state: 'SC', address: 'R. das Flores, 100 - Mar Grosso, Laguna - SC, 88790-000' })
    expect(r.foundWebsiteVerificar).toBe(false)
  })

  it('rua e estado não confirmam', () => {
    const r = extractFromResults(
      [{ title: 'Pousada Sol', url: 'https://pousadasol.com.br', content: 'Pousada Sol, Rua das Flores, SC' }],
      'Pousada Sol',
      { city: 'Tubarão', state: 'SC', addressComponents: components.filter((c) => !c.types.includes('sublocality')) },
    )
    expect(r.foundWebsiteVerificar).toBe(true)
  })
})

describe('segunda busca pelo @ do Instagram', () => {
  const loc = { city: 'Tubarão', state: 'SC' }

  it('domínio que só cita o @ mas não tem relação com nome/@ é descartado', () => {
    const r = extractSiteByHandle([{ title: 'Quadras de areia', url: 'https://gtrsports.com.br', content: 'Instagram: @arena.gtr' }], 'Arena GTR Beach Sports', 'arena.gtr', loc)
    expect(r).toBeNull()
  })

  it('domínio sem nome nem @ é rejeitado', () => {
    expect(extractSiteByHandle([{ title: 'Outra coisa', url: 'https://outra.com.br', content: 'Tubarão' }], 'Arena GTR Beach Sports', 'arena.gtr', loc)).toBeNull()
  })
})

describe('mentionsBusiness (>= 70% dos tokens)', () => {
  const r = (content: string): SearchResult => ({ title: '', url: 'https://x.com', content })
  it('snippet cortado faltando 1 de 4 tokens passa', () => {
    expect(mentionsBusiness(r('alfa bravo charlie'), 'alfa bravo charlie delta')).toBe(true)
  })
  it('faltando 2 de 4 tokens falha', () => {
    expect(mentionsBusiness(r('alfa bravo'), 'alfa bravo charlie delta')).toBe(false)
  })
})

describe('Tavily: custo explícito e erros', () => {
  afterEach(() => vi.unstubAllGlobals())
  const okBody = (credits = 1) => new Response(JSON.stringify({ results: [{ title: 't', url: 'https://x.com', content: 'c'.repeat(900) }], usage: { credits } }), { status: 200 })

  it('manda parâmetros de custo EXPLÍCITOS: basic (1 crédito), sem auto_parameters, sem resposta LLM, sem conteúdo bruto', async () => {
    let body: Record<string, unknown> = {}
    vi.stubGlobal('fetch', async (_u: string, init: { body: string }) => { body = JSON.parse(init.body); return okBody() })
    const out = await new TavilyProvider('k').search('arena tribo')
    expect(body).toMatchObject({ query: 'arena tribo', search_depth: 'basic', auto_parameters: false, include_answer: false, include_raw_content: false, include_images: false, max_results: 10 })
    expect(body).toEqual({ query: 'arena tribo', ...TAVILY_PARAMS })
    expect(out[0].content.length).toBeLessThanOrEqual(400) // só guarda o necessário
  })
  it('avisa se uma busca consumir mais de 1 crédito (config de custo furada)', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('fetch', async () => okBody(2))
    await new TavilyProvider('k').search('x')
    expect(err).toHaveBeenCalledWith(expect.stringContaining('2 créditos'))
    err.mockRestore()
  })
  it('401 → auth inválida; 429 → rate limit (com Retry-After); 432/433 → limite do plano; 5xx → erro comum', async () => {
    const p = new TavilyProvider('k')
    vi.stubGlobal('fetch', async () => new Response('', { status: 401 }))
    await expect(p.search('x')).rejects.toBeInstanceOf(ProviderAuthError)
    vi.stubGlobal('fetch', async () => new Response('', { status: 429, headers: { 'retry-after': '7' } }))
    await expect(p.search('x')).rejects.toMatchObject({ constructor: ProviderRateLimitError, retryAfterMs: 7000 })
    for (const st of [432, 433]) { vi.stubGlobal('fetch', async () => new Response('', { status: st })); await expect(p.search('x')).rejects.toBeInstanceOf(ProviderPlanLimitError) }
    vi.stubGlobal('fetch', async () => new Response('', { status: 502 }))
    await expect(p.search('x')).rejects.not.toBeInstanceOf(ProviderAuthError)
  })
})

describe('searchTavily: cache e orçamento antes de gastar', () => {
  beforeEach(() => {
    _resetQuotaForTests(); setQuotaStore(new MemoryQuotaStore()); setCacheStore(new MemoryCacheStore())
    Object.assign(env, { TAVILY_MONTHLY_BUDGET: 3, TAVILY_DAILY_BUDGET: undefined, TAVILY_HOURLY_BUDGET: undefined, API_QUOTA_SAFETY_PERCENT: 0, TAVILY_EXTERNAL_RESERVED: 0, API_OPERATION_BUDGETS: undefined, SEARCH_CACHE_TTL_HOURS: 168, SEARCH_CACHE_NEGATIVE_TTL_HOURS: 24 })
  })
  afterEach(() => _setSearchProviderForTests(undefined))

  it('a mesma consulta (acento/caixa diferentes) é servida do cache: 1 chamada, 1 crédito', async () => {
    const search = vi.fn(async () => [{ title: 'a', url: 'https://x.com', content: 'c' }])
    _setSearchProviderForTests({ search })
    const a = await searchTavily('Arena Tribo Tubarão SC')
    const b = await searchTavily('  arena   tribo tubarao sc ')
    expect(search).toHaveBeenCalledTimes(1)
    expect(a.status === 'OK' && !a.fromCache).toBe(true)
    expect(b.status === 'OK' && b.fromCache).toBe(true)
    expect((await getUsage()).usage.TAVILY.janelas.M.usado).toBe(1)
  })
  it('sem orçamento não chama o provedor; sem chave configurada devolve NOT_CONFIGURED', async () => {
    Object.assign(env, { TAVILY_MONTHLY_BUDGET: 1 })
    const search = vi.fn(async () => [] as SearchResult[])
    _setSearchProviderForTests({ search })
    await searchTavily('q1')
    const r = await searchTavily('q2')
    expect(r.status).toBe('BLOCKED')
    expect(search).toHaveBeenCalledTimes(1)
    _setSearchProviderForTests(null)
    expect((await searchTavily('q3')).status).toBe('NOT_CONFIGURED')
  })
})
