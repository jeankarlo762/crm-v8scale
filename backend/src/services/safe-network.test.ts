import { describe, it, expect, vi } from 'vitest'

const dns = vi.hoisted(() => ({ lookup: vi.fn() }))
vi.mock('node:dns/promises', () => dns)
import { assertPublicHost, isPrivateIp, readTextLimited } from './safe-network'

describe('SSRF', () => {
  it('IPs privados/metadata/loopback/CGNAT/IPv6 local', () => {
    for (const ip of ['127.0.0.1', '10.0.0.5', '192.168.1.1', '172.16.0.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1']) expect(isPrivateIp(ip)).toBe(true)
    for (const ip of ['8.8.8.8', '93.184.216.34', '2606:4700::1111']) expect(isPrivateIp(ip)).toBe(false)
  })
  it('hostname que resolve para IP interno é barrado (DNS rebinding), hostname interno também', async () => {
    dns.lookup.mockResolvedValue([{ address: '10.0.0.7', family: 4 }])
    expect(await assertPublicHost('evil.example.com')).toBe(false)
    dns.lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }, { address: '127.0.0.1', family: 4 }])
    expect(await assertPublicHost('mixed.example.com')).toBe(false)
    expect(await assertPublicHost('localhost')).toBe(false)
    expect(await assertPublicHost('metadata.internal')).toBe(false)
    expect(await assertPublicHost('169.254.169.254')).toBe(false)
    dns.lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
    expect(await assertPublicHost('ok.example.com')).toBe(true)
  })
  it('corpo é cortado no limite e conteúdo não-texto é ignorado', async () => {
    expect((await readTextLimited(new Response('a'.repeat(5000), { headers: { 'content-type': 'text/html' } }), 1000)).length).toBe(1000)
    expect(await readTextLimited(new Response('%PDF', { headers: { 'content-type': 'application/pdf' } }))).toBe('')
  })
})
