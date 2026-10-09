import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { checkSiteHealth } from './site-health.service'

// Sem DNS real nos testes: todo host resolve para um IP público.
vi.mock('node:dns/promises', () => ({ lookup: async () => [{ address: '93.184.216.34', family: 4 }] }))

type Step = { status?: number; headers?: Record<string, string>; body?: string; error?: { code?: string; name?: string; cause?: string } }

// Cada chamada ao fetch consome o próximo passo; `insecure` diferencia a requisição sem validar certificado.
function mockFetch(steps: Step[], insecureSteps: Step[] = []) {
  const calls: { url: string; insecure: boolean; headers: Record<string, string> }[] = []
  vi.stubGlobal('fetch', async (url: string, init: { dispatcher?: unknown; headers: Record<string, string> }) => {
    const insecure = !!init.dispatcher
    calls.push({ url, insecure, headers: init.headers })
    const list = insecure ? insecureSteps : steps
    const step = list[Math.min(calls.filter((c) => c.insecure === insecure).length - 1, list.length - 1)]
    if (step.error) {
      const e: Error & { cause?: unknown } = new Error('fetch failed')
      if (step.error.name) e.name = step.error.name
      if (step.error.cause) e.cause = { code: step.error.cause }
      throw e
    }
    return new Response(step.body ?? '<html>ok</html>', { status: step.status ?? 200, headers: step.headers })
  })
  return calls
}

const netErr = (code: string): Step => ({ error: { cause: code } })

describe('checkSiteHealth', () => {
  beforeEach(() => vi.unstubAllGlobals())
  afterEach(() => vi.unstubAllGlobals())

  it('manda headers de navegador (Chrome, Accept-Language pt-BR)', async () => {
    const calls = mockFetch([{ status: 200 }])
    await checkSiteHealth('https://arena.com.br')
    expect(calls[0].headers['User-Agent']).toMatch(/Chrome\/\d+/)
    expect(calls[0].headers['Accept-Language']).toMatch(/^pt-BR/)
    expect(calls[0].headers.Accept).toContain('text/html')
  })

  it('200 -> ok', async () => {
    mockFetch([{ status: 200 }])
    expect((await checkSiteHealth('https://arena.com.br')).status).toBe('ok')
  })

  it.each([401, 403, 429])('%i é bloqueio a robôs -> ok, sem retentativa', async (status) => {
    const calls = mockFetch([{ status }])
    const r = await checkSiteHealth('https://arena.com.br')
    expect(r.status).toBe('ok')
    expect(r.reason).toContain('bloqueia robôs')
    expect(calls).toHaveLength(1)
  })

  it('503 do Cloudflare (challenge) -> ok', async () => {
    mockFetch([{ status: 503, headers: { server: 'cloudflare', 'cf-ray': 'abc' } }])
    const r = await checkSiteHealth('https://arena.com.br')
    expect(r.status).toBe('ok')
    expect(r.reason).toContain('bloqueia robôs')
  })

  it('404 -> ok (o site responde)', async () => {
    mockFetch([{ status: 404 }])
    expect((await checkSiteHealth('https://arena.com.br')).status).toBe('ok')
  })

  it('5xx só na primeira tentativa: a retentativa salva', async () => {
    const calls = mockFetch([{ status: 502 }, { status: 200 }])
    expect((await checkSiteHealth('https://arena.com.br')).status).toBe('ok')
    expect(calls).toHaveLength(2)
  })

  it('5xx nas duas tentativas -> fora_do_ar (tenta HTTP antes)', async () => {
    mockFetch([{ status: 500 }])
    const r = await checkSiteHealth('https://arena.com.br')
    expect(r.status).toBe('fora_do_ar')
    expect(r.reason).toContain('HTTP 500')
  })

  it('DNS não resolve -> fora_do_ar após 2 tentativas', async () => {
    const calls = mockFetch([netErr('ENOTFOUND')])
    const r = await checkSiteHealth('https://naoexiste.com.br')
    expect(r.status).toBe('fora_do_ar')
    expect(r.reason).toContain('DNS')
    expect(calls.filter((c) => c.url.startsWith('https')).length).toBe(2)
  })

  it('conexão recusada -> fora_do_ar', async () => {
    mockFetch([netErr('ECONNREFUSED')])
    const r = await checkSiteHealth('https://arena.com.br')
    expect(r.status).toBe('fora_do_ar')
    expect(r.reason).toContain('recusada')
  })

  it('timeout nas duas tentativas -> fora_do_ar; timeout só na primeira -> ok', async () => {
    mockFetch([{ error: { name: 'TimeoutError' } }])
    const r = await checkSiteHealth('https://arena.com.br')
    expect(r.status).toBe('fora_do_ar')
    expect(r.reason).toContain('timeout')
    mockFetch([{ error: { name: 'TimeoutError' } }, { status: 200 }])
    expect((await checkSiteHealth('https://arena.com.br')).status).toBe('ok')
  })

  it('HTTPS recusado mas HTTP responde -> sem_https', async () => {
    vi.stubGlobal('fetch', async (url: string) => {
      if (url.startsWith('https')) throw Object.assign(new Error('x'), { cause: { code: 'ECONNREFUSED' } })
      return new Response('<html>ok</html>', { status: 200 })
    })
    expect((await checkSiteHealth('https://arena.com.br')).status).toBe('sem_https')
  })

  it.each([
    ['CERT_HAS_EXPIRED', 'expirado'],
    ['UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'cadeia'],
    ['ERR_TLS_CERT_ALTNAME_INVALID', 'outro domínio'],
  ])('erro %s e o site responde sem validar -> certificado_invalido', async (code, texto) => {
    const calls = mockFetch([netErr(code)], [{ status: 200 }])
    const r = await checkSiteHealth('https://arena.com.br')
    expect(r.status).toBe('certificado_invalido')
    expect(r.reason).toContain(texto)
    expect(calls.some((c) => c.insecure)).toBe(true)
  })

  it('certificado inválido e site não responde nem sem validar -> fora_do_ar', async () => {
    mockFetch([netErr('CERT_HAS_EXPIRED')], [netErr('ECONNREFUSED')])
    expect((await checkSiteHealth('https://arena.com.br')).status).toBe('fora_do_ar')
  })

  it('domínio à venda -> dominio_parado', async () => {
    mockFetch([{ status: 200, body: '<html>This domain is for sale</html>' }])
    expect((await checkSiteHealth('https://arena.com.br')).status).toBe('dominio_parado')
  })
})
