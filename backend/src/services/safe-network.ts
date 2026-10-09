// Proteção SSRF e leitura limitada para qualquer fetch de URL descoberta (Tavily/Instagram/bio).
// isPrivateHost cobre o que dá pra ver no texto; assertPublicHost resolve o DNS e barra o host que
// aponta pra rede interna (inclusive metadata 169.254.169.254).
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

export const MAX_BODY_BYTES = 512 * 1024

// IPv4/IPv6 literais em faixa privada, loopback, link-local, CGNAT ou não-roteável.
export function isPrivateIp(ip: string): boolean {
  const v = ip.toLowerCase().replace(/^\[|\]$/g, '')
  const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  if (mapped) return isPrivateIp(mapped[1])
  if (isIP(v) === 4) {
    const [a, b] = v.split('.').map(Number)
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || a >= 224
  }
  if (isIP(v) === 6) return v === '::' || v === '::1' || /^f[cd]/.test(v) || /^fe[89ab]/.test(v) || v.startsWith('ff')
  return false
}

// Rejeita hostname interno; resolve o DNS e rejeita se QUALQUER endereço for privado.
// DNS que falha não é bloqueio (o fetch seguinte reporta o erro real).
export async function assertPublicHost(hostname: string): Promise<boolean> {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return false
  if (isIP(h)) return !isPrivateIp(h)
  try {
    const addrs = await lookup(h, { all: true })
    return addrs.every((a) => !isPrivateIp(a.address))
  } catch {
    return true
  }
}

// Lê o corpo até `max` bytes e cancela o resto (páginas enormes). Só texto/HTML.
export async function readTextLimited(res: Response, max = MAX_BODY_BYTES): Promise<string> {
  const type = res.headers.get('content-type') ?? ''
  if (type && !/text\/|html|xml|json/i.test(type)) { await res.body?.cancel().catch(() => {}); return '' }
  if (!res.body) return ''
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (size < max) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      size += value.byteLength
    }
  } catch { /* corpo interrompido: usa o que veio */ }
  await reader.cancel().catch(() => {})
  return Buffer.concat(chunks).subarray(0, max).toString('utf-8')
}
