import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  reserve: vi.fn(async (): Promise<{ ok: boolean; code?: string; detail?: string; retryAt?: Date | null }> => ({ ok: true })),
  pause: vi.fn(async () => {}),
  env: { PLACES_MOCK: 'false', GOOGLE_PLACES_API_KEY: 'k', MAX_GOOGLE_QUERIES_PER_CITY: 4, MAX_GOOGLE_PAGES_PER_QUERY: 3, MAX_GOOGLE_REQUESTS_PER_SEARCH: 10, GOOGLE_EXPANSION_MIN_NEW: 2, PLACES_CACHE_TTL_HOURS: 0, GOOGLE_EVIDENCE_TTL_HOURS: 720 },
}))
vi.mock('../config/env', () => ({ env: mocks.env }))
vi.mock('../config/database', () => ({ prisma: {} }))
vi.mock('./provider-state.service', () => ({ getProviderPause: async () => null, listProviderStates: async () => [], pauseProvider: mocks.pause, resumeProvider: async () => {} }))
vi.mock('./api-quota.service', () => ({ reserve: mocks.reserve, noteSaved: () => {}, pauseKeyOf: (p: string) => (p.startsWith('GOOGLE_') ? 'GOOGLE_PLACES' : p), OPERATIONS: { GOOGLE_TEXT_SEARCH: 'TEXT_SEARCH_PRO', GOOGLE_PLACE_DETAILS: 'PLACE_DETAILS_ENTERPRISE', TAVILY_SEARCH: 'SEARCH_BASIC', META_BUSINESS_DISCOVERY: 'BUSINESS_DISCOVERY' } }))

import { searchPlaces, newSearchStats, belongsToRequestedCity, buildQueries, FIELD_MASK, ENTERPRISE_ONLY_FIELDS, assertProMask, fetchPlaceDetails as fetchPlaceWebsiteField, DETAILS_FIELD_MASK, type AddressComponent } from './places.service'
import { GOOGLE_COLLECTION_VERSIONS } from './website-types'
import { setCacheStore, MemoryCacheStore } from './api-guard.service'

const comps = (city: string, uf: string): AddressComponent[] => [
  { longText: city, shortText: city, types: ['locality', 'political'] },
  { longText: 'Santa Catarina', shortText: uf, types: ['administrative_area_level_1', 'political'] },
  { longText: 'Brasil', shortText: 'BR', types: ['country', 'political'] },
]
const raw = (id: string, city = 'Tubarão', uf = 'SC') => ({ id, displayName: { text: id }, addressComponents: comps(city, uf) })

// Cada chamada do fetch consome a próxima resposta; guarda o corpo enviado.
function stubFetch(pages: { places: unknown[]; nextPageToken?: string }[]) {
  const bodies: Record<string, unknown>[] = []
  vi.stubGlobal('fetch', async (_u: string, init: { body: string }) => {
    bodies.push(JSON.parse(init.body))
    return new Response(JSON.stringify(pages[Math.min(bodies.length - 1, pages.length - 1)]), { status: 200 })
  })
  return bodies
}

describe('searchPlaces', () => {
  beforeEach(() => { vi.unstubAllGlobals(); setCacheStore(new MemoryCacheStore()); mocks.reserve.mockReset(); mocks.reserve.mockResolvedValue({ ok: true }); mocks.pause.mockClear(); Object.assign(mocks.env, { MAX_GOOGLE_QUERIES_PER_CITY: 4, MAX_GOOGLE_PAGES_PER_QUERY: 3, MAX_GOOGLE_REQUESTS_PER_SEARCH: 10 }) })

  it('pagina com pageToken e para quando não há nextPageToken', async () => {
    const bodies = stubFetch([{ places: [raw('a'), raw('b')], nextPageToken: 't1' }, { places: [raw('c'), raw('d')] }])
    const stats = newSearchStats()
    const r = await searchPlaces('Arena', 'Tubarão - SC', { stats })
    expect(r.map((p) => p.placeId)).toEqual(['a', 'b', 'c', 'd'])
    expect(bodies[1]).toMatchObject({ pageToken: 't1', textQuery: 'Arena em Tubarão - SC' })
    expect(stats.calls).toBe(2)
  })

  it('MAX_GOOGLE_PAGES_PER_QUERY=1 (default conservador): só a página 1 mesmo com nextPageToken', async () => {
    mocks.env.MAX_GOOGLE_PAGES_PER_QUERY = 1
    stubFetch([{ places: [raw('a')], nextPageToken: 't1' }])
    const stats = newSearchStats()
    await searchPlaces('Arena', 'Tubarão - SC', { stats })
    expect(stats.calls).toBe(1)
  })

  it('L: mesma empresa em várias queries = um placeId só', async () => {
    mocks.env.MAX_GOOGLE_PAGES_PER_QUERY = 1
    stubFetch([{ places: [raw('a'), raw('b'), raw('c')] }, { places: [raw('a'), raw('b'), raw('d'), raw('e'), raw('f')] }])
    const r = await searchPlaces('Arena', 'Tubarão - SC', { termos: ['Quadra society', 'Campo'], stats: newSearchStats() })
    expect(r.map((p) => p.placeId)).toEqual(['a', 'b', 'c', 'd', 'e', 'f'])
  })

  it('retorno decrescente: alias que traz poucos novos encerra a expansão', async () => {
    mocks.env.MAX_GOOGLE_PAGES_PER_QUERY = 1
    const bodies = stubFetch([{ places: [raw('a'), raw('b')] }, { places: [raw('a'), raw('c')] }, { places: [raw('z')] }])
    const stats = newSearchStats()
    await searchPlaces('Arena', 'Tubarão - SC', { termos: ['x', 'y'], stats }) // alias x trouxe 1 novo (<2): não roda o y
    expect(bodies).toHaveLength(2)
    expect(stats.stoppedBy).toBe('diminishing_returns')
  })

  it('respeita o teto de requisições da busca', async () => {
    const bodies = stubFetch([{ places: [raw('a'), raw('b'), raw('c')], nextPageToken: 't' }])
    const stats = newSearchStats()
    await searchPlaces('Arena', 'Tubarão - SC', { termos: ['x'], maxRequests: 2, stats })
    expect(bodies.length).toBeLessThanOrEqual(2)
    expect(stats.stoppedBy).toBe('max_requests')
  })

  it('sem orçamento: para sem chamar o Google; sem nenhum resultado, falha com 429 (não "zero leads")', async () => {
    mocks.reserve.mockResolvedValue({ ok: false, code: 'WINDOW_M', detail: 'GOOGLE_PLACES sem orçamento (M: 900/900)', retryAt: new Date('2026-11-01T00:00:00Z') })
    const bodies = stubFetch([{ places: [raw('a')] }])
    await expect(searchPlaces('Arena', 'Tubarão - SC', { stats: newSearchStats() })).rejects.toMatchObject({ statusCode: 429 })
    expect(bodies).toHaveLength(0)
  })

  it('M: resultado de outra cidade/estado é filtrado; sem addressComponents não é descartado', async () => {
    mocks.env.MAX_GOOGLE_PAGES_PER_QUERY = 1
    stubFetch([{ places: [raw('ok'), raw('outra-cidade', 'Laguna'), raw('outro-estado', 'Tubarão', 'PR'), { id: 'sem-comps', displayName: { text: 'x' } }] }])
    const stats = newSearchStats()
    const r = await searchPlaces('Arena', 'Tubarão - SC', { stats })
    expect(r.map((p) => p.placeId)).toEqual(['ok', 'sem-comps'])
    expect(stats.filtradosForaDaCidade).toBe(2)
  })

  it('descarta fechado permanentemente', async () => {
    mocks.env.MAX_GOOGLE_PAGES_PER_QUERY = 1
    stubFetch([{ places: [raw('a'), { ...raw('b'), businessStatus: 'CLOSED_PERMANENTLY' }] }])
    expect((await searchPlaces('Arena', 'Tubarão - SC', { stats: newSearchStats() })).map((p) => p.placeId)).toEqual(['a'])
  })

  it('erro 4xx na 2ª página mantém o que já veio e não faz retry', async () => {
    let n = 0
    vi.stubGlobal('fetch', async () => (++n === 1 ? new Response(JSON.stringify({ places: [raw('a')], nextPageToken: 't' }), { status: 200 }) : new Response('bad', { status: 400 })))
    const r = await searchPlaces('Arena', 'Tubarão - SC', { stats: newSearchStats() })
    expect(r).toHaveLength(1)
    expect(n).toBe(2)
  })
})

describe('searchPlaces: orçamento e SKU', () => {
  beforeEach(() => { vi.unstubAllGlobals(); setCacheStore(new MemoryCacheStore()); mocks.reserve.mockReset(); mocks.reserve.mockResolvedValue({ ok: true }); mocks.pause.mockClear(); Object.assign(mocks.env, { MAX_GOOGLE_QUERIES_PER_CITY: 1, MAX_GOOGLE_PAGES_PER_QUERY: 3, MAX_GOOGLE_REQUESTS_PER_SEARCH: 10 }) })

  it('toda página reserva orçamento ANTES de chamar, na operação do Text Search PRO', async () => {
    stubFetch([{ places: [raw('a')], nextPageToken: 't' }, { places: [raw('b')] }])
    await searchPlaces('Arena', 'Tubarão - SC', { stats: newSearchStats() })
    expect(mocks.reserve).toHaveBeenCalledTimes(2)
    expect(mocks.reserve).toHaveBeenCalledWith('GOOGLE_TEXT_SEARCH_PRO', expect.objectContaining({ operation: 'TEXT_SEARCH_PRO' }))
  })

  it('retry de 5xx também reserva (2 tentativas = 2 reservas) e a reserva não é devolvida', async () => {
    let n = 0
    vi.stubGlobal('fetch', async () => (++n === 1 ? new Response('x', { status: 503 }) : new Response(JSON.stringify({ places: [raw('a')] }), { status: 200 })))
    const r = await searchPlaces('Arena', 'Tubarão - SC', { stats: newSearchStats() })
    expect(r).toHaveLength(1)
    expect(n).toBe(2)
    expect(mocks.reserve).toHaveBeenCalledTimes(2)
    for (const c of mocks.reserve.mock.calls as unknown as [string, { operation: string }][]) expect([c[0], c[1].operation]).toEqual(['GOOGLE_TEXT_SEARCH_PRO', 'TEXT_SEARCH_PRO']) // as duas tentativas na cota do Pro
  })

  it('retry sem orçamento: a 2ª tentativa NÃO chama o Google', async () => {
    mocks.reserve.mockResolvedValueOnce({ ok: true }).mockResolvedValue({ ok: false, code: 'WINDOW_H', detail: 'sem orçamento', retryAt: null })
    let n = 0
    vi.stubGlobal('fetch', async () => { n++; return new Response('x', { status: 503 }) })
    await expect(searchPlaces('Arena', 'Tubarão - SC', { stats: newSearchStats() })).rejects.toMatchObject({ statusCode: 429 })
    expect(n).toBe(1)
  })

  it('401/403 pausa a integração (credencial/API) e não é retentado', async () => {
    let n = 0
    vi.stubGlobal('fetch', async () => { n++; return new Response('denied', { status: 403 }) })
    await expect(searchPlaces('Arena', 'Tubarão - SC', { stats: newSearchStats() })).rejects.toBeTruthy()
    expect(n).toBe(1)
    expect(mocks.pause).toHaveBeenCalledWith('GOOGLE_PLACES', expect.stringContaining('403'))
  })

  it('429 é rate limit: sem retry', async () => {
    let n = 0
    vi.stubGlobal('fetch', async () => { n++; return new Response('slow', { status: 429 }) })
    await expect(searchPlaces('Arena', 'Tubarão - SC', { stats: newSearchStats() })).rejects.toMatchObject({ statusCode: 429 })
    expect(n).toBe(1)
  })

  it('FieldMask do Text Search é PRO: nenhum campo Enterprise (telefone, site, nota, avaliações) e a trava recusa máscaras com eles', () => {
    for (const f of ENTERPRISE_ONLY_FIELDS) expect(FIELD_MASK, f).not.toContain(f)
    for (const f of ['places.id', 'places.displayName', 'places.formattedAddress', 'places.addressComponents', 'places.businessStatus', 'places.primaryType', 'places.types', 'places.googleMapsUri']) expect(FIELD_MASK).toContain(f)
    expect(() => assertProMask(FIELD_MASK)).not.toThrow()
    for (const bad of ['places.id,places.websiteUri', 'places.nationalPhoneNumber', 'places.rating', 'places.id,places.userRatingCount', 'places.internationalPhoneNumber']) expect(() => assertProMask(bad), bad).toThrow(/Enterprise/)
  })
})

describe('belongsToRequestedCity / buildQueries', () => {
  it('compara sem acento e usa admin_area_2 como município', () => {
    expect(belongsToRequestedCity({ addressComponents: [{ longText: 'Tubarao', types: ['administrative_area_level_2'] }], endereco: null }, 'Tubarão', 'SC')).toBe('yes')
    expect(belongsToRequestedCity({ addressComponents: null, endereco: null }, 'Tubarão', 'SC')).toBe('unknown')
    expect(belongsToRequestedCity({ addressComponents: null, endereco: 'Rua A, 1 - Centro, Tubarão - SC, Brasil' }, 'Tubarão', 'SC')).toBe('yes')
  })
  it('queries: principal primeiro, aliases sem repetir', () => {
    expect(buildQueries('Arenas', 'Tubarão - SC', ['arenas', 'Padel'])).toEqual(['Arenas em Tubarão - SC', 'Padel em Tubarão - SC'])
  })
})

describe('proveniência da coleta do Google (evidência do campo websiteUri)', () => {
  beforeEach(() => { vi.unstubAllGlobals(); setCacheStore(new MemoryCacheStore()); mocks.reserve.mockReset(); mocks.reserve.mockResolvedValue({ ok: true }); Object.assign(mocks.env, { PLACES_MOCK: 'false', GOOGLE_PLACES_API_KEY: 'k', PLACES_CACHE_TTL_HOURS: 0, MAX_GOOGLE_PAGES_PER_QUERY: 1, MAX_GOOGLE_QUERIES_PER_CITY: 1 }) })

  it('só o Place Details pede telefone/website/nota/avaliações (e é a ÚNICA fonte de evidência do campo websiteUri)', () => {
    for (const f of ['nationalPhoneNumber', 'internationalPhoneNumber', 'websiteUri', 'rating', 'userRatingCount']) expect(DETAILS_FIELD_MASK).toContain(f)
    expect(GOOGLE_COLLECTION_VERSIONS).toContain('place-details-enterprise:v1')
  })

  it('cada lugar da descoberta sai com a data real da resposta e SEM telefone, site, nota ou avaliações (nulos)', async () => {
    stubFetch([{ places: [raw('a')] }])
    const antes = Date.now()
    const [p] = await searchPlaces('Arena', 'Tubarão - SC', { stats: newSearchStats() })
    expect(p).toMatchObject({ placeId: 'a', fromCache: false, telefone: null, telefoneInternacional: null, website: null, avaliacao: null, numAvaliacoes: null })
    expect(p.collectedAt!.getTime()).toBeGreaterThanOrEqual(antes)
  })

  it('resposta vinda de CACHE preserva a data da coleta original (e não gasta chamada nem orçamento)', async () => {
    Object.assign(mocks.env, { PLACES_CACHE_TTL_HOURS: 24 })
    const bodies = stubFetch([{ places: [raw('a')] }])
    const [first] = await searchPlaces('Arena', 'Tubarão - SC', { stats: newSearchStats() })
    await new Promise((r) => setTimeout(r, 15))
    const [second] = await searchPlaces('Arena', 'Tubarão - SC', { stats: newSearchStats() })
    expect(bodies).toHaveLength(1) // 2ª busca = cache: nenhuma chamada nova
    expect(mocks.reserve).toHaveBeenCalledTimes(1)
    expect(second.fromCache).toBe(true)
    expect(second.collectedAt!.getTime()).toBe(first.collectedAt!.getTime()) // data real da coleta, não de agora
  })

  it('Place Details: reserva antes, devolve o campo (consultado sem resultado = null) e o 2º pedido vem do cache com a data original', async () => {
    Object.assign(mocks.env, { GOOGLE_EVIDENCE_TTL_HOURS: 720 })
    const calls: string[] = []
    vi.stubGlobal('fetch', async (u: string, init: { headers: Record<string, string> }) => { calls.push(`${u}|${init.headers['X-Goog-FieldMask']}`); return new Response(JSON.stringify({ id: 'abc' }), { status: 200 }) })
    const a = await fetchPlaceWebsiteField('abc')
    expect(a.status).toBe('OK')
    if (a.status !== 'OK') return
    expect(a.data).toMatchObject({ placeId: 'abc', websiteUri: null, nationalPhone: null, rating: null, collection: 'place-details-enterprise:v1' })
    expect(mocks.reserve).toHaveBeenCalledWith('GOOGLE_PLACE_DETAILS_ENTERPRISE', expect.objectContaining({ operation: 'PLACE_DETAILS_ENTERPRISE' }))
    expect(calls[0]).toContain('/places/abc|id,nationalPhoneNumber,internationalPhoneNumber,websiteUri,rating,userRatingCount')
    await new Promise((r) => setTimeout(r, 15))
    const b = await fetchPlaceWebsiteField('abc')
    expect(b.status === 'OK' && b.fromCache).toBe(true)
    expect(b.status === 'OK' && b.collectedAt.getTime()).toBe(a.collectedAt.getTime())
    expect(calls).toHaveLength(1)
  })

  it('resposta de outro id ou sem corpo válido NÃO prova nada sobre o campo (erro técnico, nunca "sem site")', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ id: 'outro' }), { status: 200 }))
    const r = await fetchPlaceWebsiteField('abc')
    expect(r.status).toBe('ERROR')
  })

  it('sem orçamento não chama o Google; mock/sem chave = NOT_CONFIGURED; 401 pausa a integração', async () => {
    const fetchSpy = vi.fn(async () => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchSpy)
    mocks.reserve.mockResolvedValueOnce({ ok: false, code: 'WINDOW_M', detail: 'sem orçamento', retryAt: null })
    expect((await fetchPlaceWebsiteField('abc')).status).toBe('BLOCKED')
    expect(fetchSpy).not.toHaveBeenCalled()
    Object.assign(mocks.env, { PLACES_MOCK: 'true' }); expect(await fetchPlaceWebsiteField('abc')).toEqual({ status: 'NOT_CONFIGURED' })
    Object.assign(mocks.env, { PLACES_MOCK: 'false', GOOGLE_PLACES_API_KEY: '' }); expect(await fetchPlaceWebsiteField('abc')).toEqual({ status: 'NOT_CONFIGURED' })
    Object.assign(mocks.env, { GOOGLE_PLACES_API_KEY: 'k' })
    vi.stubGlobal('fetch', async () => new Response('{}', { status: 403 }))
    expect((await fetchPlaceWebsiteField('xyz')).status).toBe('AUTH')
    expect(mocks.pause).toHaveBeenCalledWith('GOOGLE_PLACES', expect.any(String))
  })
})

describe('Place Details: retries e proteção por operação (sem rede real)', () => {
  beforeEach(() => { vi.unstubAllGlobals(); setCacheStore(new MemoryCacheStore()); mocks.reserve.mockReset(); mocks.reserve.mockResolvedValue({ ok: true }); Object.assign(mocks.env, { PLACES_MOCK: 'false', GOOGLE_PLACES_API_KEY: 'k', GOOGLE_EVIDENCE_TTL_HOURS: 720 }) })

  it('nenhum teste faz chamada real: o fetch global está bloqueado até alguém o simular', async () => {
    expect(() => fetch('https://places.googleapis.com/v1/places:searchText')).toThrow(/bloqueado/)
  })

  it('retry de 5xx no Details reserva DUAS vezes, ambas no orçamento do Details Enterprise (nunca no do Pro)', async () => {
    let n = 0
    vi.stubGlobal('fetch', async () => (++n === 1 ? new Response('x', { status: 503 }) : new Response(JSON.stringify({ id: 'abc', websiteUri: 'https://x.com.br', nationalPhoneNumber: '(48) 99123-4567', rating: 4.6, userRatingCount: 80 }), { status: 200 })))
    const r = await fetchPlaceWebsiteField('abc')
    expect(r.status).toBe('OK')
    if (r.status === 'OK') expect(r.data).toMatchObject({ websiteUri: 'https://x.com.br', nationalPhone: '(48) 99123-4567', rating: 4.6, userRatingCount: 80 })
    expect(n).toBe(2)
    expect(mocks.reserve).toHaveBeenCalledTimes(2)
    for (const c of mocks.reserve.mock.calls as unknown as [string, { operation: string }][]) expect([c[0], c[1].operation]).toEqual(['GOOGLE_PLACE_DETAILS_ENTERPRISE', 'PLACE_DETAILS_ENTERPRISE'])
  })

  it('retry sem orçamento do Details: a 2ª tentativa NÃO chama o Google', async () => {
    mocks.reserve.mockResolvedValueOnce({ ok: true }).mockResolvedValue({ ok: false, code: 'WINDOW_M', detail: 'sem saldo', retryAt: null })
    let n = 0
    vi.stubGlobal('fetch', async () => { n++; return new Response('x', { status: 503 }) })
    const r = await fetchPlaceWebsiteField('abc')
    expect(n).toBe(1)
    expect(r.status).toBe('BLOCKED')
  })

  it('4xx (≠401/403/429) não é retentado', async () => {
    let n = 0
    vi.stubGlobal('fetch', async () => { n++; return new Response('x', { status: 404 }) })
    expect((await fetchPlaceWebsiteField('abc')).status).toBe('ERROR')
    expect(n).toBe(1)
  })

  it('cache do Details: o 2º pedido do mesmo placeId não reserva cota nem chama o Google', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ id: 'abc', websiteUri: 'https://x.com.br' }), { status: 200 }))
    vi.stubGlobal('fetch', f)
    await fetchPlaceWebsiteField('abc'); await fetchPlaceWebsiteField('abc')
    expect(f).toHaveBeenCalledTimes(1)
    expect(mocks.reserve).toHaveBeenCalledTimes(1)
  })

  it('o Text Search NUNCA chama com máscara Enterprise: o corpo da requisição leva só o FieldMask Pro', async () => {
    const seen: string[] = []
    vi.stubGlobal('fetch', async (_u: string, init: { headers: Record<string, string> }) => { seen.push(init.headers['X-Goog-FieldMask']); return new Response(JSON.stringify({ places: [raw('a')] }), { status: 200 }) })
    await searchPlaces('Arena', 'Tubarão - SC', { stats: newSearchStats() })
    expect(seen).toHaveLength(1)
    expect(() => assertProMask(seen[0])).not.toThrow()
    for (const f of ENTERPRISE_ONLY_FIELDS) expect(seen[0]).not.toContain(f)
  })
})
