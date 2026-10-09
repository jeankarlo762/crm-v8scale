// Health check de um site: GET parecido com navegador (timeout 15s, seguindo redirects, 1 retentativa).
// Só é "fora_do_ar" em falha real; bloqueio a robôs (401/403/429/challenge) conta como ok.
import { Agent } from 'undici'
import { assertPublicHost, readTextLimited } from './safe-network'

export type SiteHealth = 'ok' | 'fora_do_ar' | 'sem_https' | 'dominio_parado' | 'certificado_invalido'

const TIMEOUT_MS = 15000
const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
  'Upgrade-Insecure-Requests': '1',
}
const insecureAgent = new Agent({ connect: { rejectUnauthorized: false } })
const MAX_REDIRECTS = 5
const PARKED_MARKERS = [
  'domain for sale', 'this domain is for sale', 'buy this domain', 'domain parking', 'parked domain',
  'domínio à venda', 'dominio a venda', 'este domínio está à venda', 'página padrão', 'pagina padrao',
  'sedoparking', 'hugedomains', 'dan.com', 'afternic',
]

// Evita seguir redirect/fetch pra rede interna (SSRF).
export function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase()
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal')) return true
  if (/^\[.*\]$/.test(h)) return true
  const m = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/)
  if (!m) return false
  const [a, b] = [Number(m[1]), Number(m[2])]
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
}

export function isParkedPage(html: string): boolean {
  const lower = html.toLowerCase()
  return PARKED_MARKERS.some((m) => lower.includes(m))
}


type Attempt =
  | { ok: true; finalUrl: URL; status: number; headers: Headers; html: string }
  | { ok: false; code: string }

function errorCode(e: unknown): string {
  const err = e as { name?: string; code?: string; cause?: { code?: string } }
  if (err?.name === 'TimeoutError' || err?.name === 'AbortError') return 'ETIMEDOUT'
  return err?.cause?.code ?? err?.code ?? err?.name ?? 'UNKNOWN'
}

const CERT_CODES = new Set(['CERT_HAS_EXPIRED', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'ERR_TLS_CERT_ALTNAME_INVALID', 'CERT_NOT_YET_VALID'])
const isCertError = (code: string) => CERT_CODES.has(code) || code.startsWith('ERR_TLS_CERT') || code.startsWith('ERR_SSL')
const CERT_REASONS: Record<string, string> = {
  CERT_HAS_EXPIRED: 'certificado expirado',
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'cadeia de certificados incompleta',
  UNABLE_TO_GET_ISSUER_CERT_LOCALLY: 'cadeia de certificados incompleta',
  ERR_TLS_CERT_ALTNAME_INVALID: 'certificado emitido para outro domínio',
  DEPTH_ZERO_SELF_SIGNED_CERT: 'certificado autoassinado',
  SELF_SIGNED_CERT_IN_CHAIN: 'certificado autoassinado',
}

// GET seguindo redirects na mão (bloqueia hosts privados). `insecure` ignora a validação do certificado.
async function getFollowing(startUrl: URL, insecure = false): Promise<Attempt> {
  let current = startUrl
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (isPrivateHost(current.hostname) || !(await assertPublicHost(current.hostname))) return { ok: false, code: 'HOST_PRIVADO' }
    let res: Response
    try {
      res = await fetch(current.href, {
        method: 'GET',
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: BROWSER_HEADERS,
        ...(insecure ? { dispatcher: insecureAgent } : {}),
      } as RequestInit)
    } catch (e) {
      return { ok: false, code: errorCode(e) }
    }
    const location = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null
    if (!location) {
      const html = res.status === 200 ? await readTextLimited(res) : ''
      return { ok: true, finalUrl: current, status: res.status, headers: res.headers, html }
    }
    try {
      current = new URL(location, current)
    } catch {
      return { ok: false, code: 'REDIRECT_INVALIDO' }
    }
  }
  return { ok: false, code: 'REDIRECTS_DEMAIS' }
}

const RETRYABLE_CODES = new Set(['ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET', 'UND_ERR_CONNECT_TIMEOUT'])
const isTimeout = (code: string) => code === 'ETIMEDOUT' || code === 'UND_ERR_CONNECT_TIMEOUT'

function isChallenge(a: Extract<Attempt, { ok: true }>): boolean {
  const server = (a.headers.get('server') ?? '').toLowerCase()
  const cf = server.includes('cloudflare') || a.headers.has('cf-ray')
  if (a.headers.get('cf-mitigated')) return true
  return a.status === 503 && (cf || /just a moment|cf-chl|attention required|challenge-platform/i.test(a.html))
}

type Verdict = { status: SiteHealth | 'retry'; reason: string | null; attempt: Attempt; blocked?: boolean }

function judge(a: Attempt): Verdict {
  if (!a.ok) {
    if (isCertError(a.code)) return { status: 'certificado_invalido', reason: CERT_REASONS[a.code] ?? `problema no certificado (${a.code})`, attempt: a }
    if (a.code === 'HOST_PRIVADO') return { status: 'fora_do_ar', reason: 'endereço interno bloqueado', attempt: a }
    if (RETRYABLE_CODES.has(a.code)) return { status: 'retry', reason: a.code, attempt: a }
    return { status: 'ok', reason: `não conclusivo (${a.code})`, attempt: a }
  }
  if (a.status >= 500) return isChallenge(a) ? { status: 'ok', reason: `ok (bloqueia robôs, HTTP ${a.status})`, attempt: a, blocked: true } : { status: 'retry', reason: `HTTP ${a.status}`, attempt: a }
  if (a.status === 401 || a.status === 403 || a.status === 429 || isChallenge(a)) return { status: 'ok', reason: `ok (bloqueia robôs, HTTP ${a.status})`, attempt: a, blocked: true }
  return { status: 'ok', reason: a.status >= 400 ? `site responde (HTTP ${a.status})` : null, attempt: a }
}

function failReason(code: string): string {
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'domínio não resolve (DNS)'
  if (code === 'ECONNREFUSED') return 'conexão recusada'
  if (isTimeout(code)) return 'sem resposta (timeout nas 2 tentativas)'
  if (/^HTTP 5/.test(code)) return `erro do servidor (${code} nas 2 tentativas)`
  return `falha de conexão (${code})`
}

// Uma tentativa + 1 retentativa; só devolve falha se as duas falharem.
async function tryWithRetry(url: URL): Promise<Verdict> {
  const first = judge(await getFollowing(url))
  if (first.status !== 'retry') return first
  const second = judge(await getFollowing(url))
  if (second.status !== 'retry') return second
  return { ...second, status: 'fora_do_ar', reason: failReason(second.reason ?? 'UNKNOWN') }
}

export function parseSiteUrl(raw: string): URL | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  try {
    return new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`)
  } catch {
    return null
  }
}

// httpStatus/blocked: o que a página respondeu de fato. blocked = anti-bot/401/403/429: o site EXISTE, mas o conteúdo
// não foi lido — a identidade fica "não avaliável" (nunca contradição nem confirmação).
export interface SiteHealthResult { status: SiteHealth; finalUrl: string; html: string; reason: string | null; httpStatus?: number | null; blocked?: boolean }
export async function checkSiteHealth(rawUrl: string): Promise<SiteHealthResult> {
  const start = parseSiteUrl(rawUrl)
  if (!start) return { status: 'fora_do_ar', finalUrl: rawUrl, html: '', reason: 'URL inválida' }

  let v = await tryWithRetry(start)

  // Erro de certificado: tenta sem validar só pra saber se o site responde.
  if (v.status === 'certificado_invalido') {
    const insecure = await getFollowing(start, true)
    if (insecure.ok && insecure.status < 500) {
      return { status: 'certificado_invalido', finalUrl: insecure.finalUrl.href, html: insecure.html, reason: v.reason, httpStatus: insecure.status }
    }
    v = { ...v, status: 'fora_do_ar', reason: `${v.reason}; site não responde nem sem validar o certificado` }
  }

  // HTTPS fora do ar mas HTTP responde: o site existe, só não tem HTTPS.
  if (v.status === 'fora_do_ar' && start.protocol === 'https:') {
    const http = new URL(start.href)
    http.protocol = 'http:'
    const fb = judge(await getFollowing(http))
    if (fb.status === 'ok' && fb.attempt.ok) return { status: 'sem_https', finalUrl: fb.attempt.finalUrl.href, html: fb.attempt.html, reason: 'HTTPS indisponível, responde só em HTTP', httpStatus: fb.attempt.status, blocked: !!fb.blocked }
  }
  if (v.status === 'fora_do_ar' || v.status === 'retry') return { status: 'fora_do_ar', finalUrl: start.href, html: '', reason: v.reason }
  if (v.status !== 'ok' || !v.attempt.ok) return { status: v.status as SiteHealth, finalUrl: start.href, html: '', reason: v.reason }

  const { finalUrl, html, status: httpStatus } = v.attempt
  const meta = { httpStatus, blocked: !!v.blocked }
  if (isParkedPage(html)) return { status: 'dominio_parado', finalUrl: finalUrl.href, html, reason: 'página de domínio à venda/parado', ...meta }
  if (finalUrl.protocol !== 'https:') return { status: 'sem_https', finalUrl: finalUrl.href, html, reason: 'site abre em HTTP, sem HTTPS', ...meta }
  return { status: 'ok', finalUrl: finalUrl.href, html, reason: v.reason, ...meta }
}
