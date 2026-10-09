// Ciclo de reset das cotas por provedor — explícito, nunca presumido. Puro (sem banco): recebe a configuração e o instante.
// O que NÃO sabemos do provedor (fuso, dia de cobrança, se o limite é móvel) vem da configuração e deve ser conferido no
// console do provedor; configuração ausente ou incompatível BLOQUEIA o provedor (ver api-quota.configBlock).
//
//  FIXED             hora: UTC; mês: calendário no fuso configurado
//  ANCHOR_DAY:<n>    mês de cobrança que reinicia no dia n (1-28), 00:00 no fuso configurado (só janela mensal)
//  ROLLING           limite móvel. Política conservadora: o consumo é somado em baldes finos (minuto/dia UTC) dos
//                    últimos 60 min / 30 dias, e nada é liberado antes de o balde sair da soma.
export type Window = 'H' | 'M'
export type CycleMode = 'FIXED' | 'ANCHOR_DAY' | 'ROLLING'
export interface CycleConfig { mode: CycleMode; anchorDay?: number; tz: string }

export function parseCycle(reset: string | undefined, tz: string | undefined): { ok: true; value: CycleConfig } | { ok: false; error: string } {
  const zone = tz?.trim() || 'UTC'
  try { new Intl.DateTimeFormat('en-US', { timeZone: zone }) } catch { return { ok: false, error: `fuso inválido "${zone}"` } }
  const r = reset?.trim().toUpperCase()
  if (!r) return { ok: false, error: 'ciclo de reset não configurado' }
  if (r === 'FIXED' || r === 'ROLLING') return { ok: true, value: { mode: r, tz: zone } }
  const m = r.match(/^ANCHOR_DAY:(\d{1,2})$/)
  if (m && Number(m[1]) >= 1 && Number(m[1]) <= 28) return { ok: true, value: { mode: 'ANCHOR_DAY', anchorDay: Number(m[1]), tz: zone } }
  return { ok: false, error: `ciclo "${reset}" inválido (use FIXED, ANCHOR_DAY:<1-28> ou ROLLING)` }
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0')

function zonedParts(d: Date, tz: string) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]))
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), h: Number(p.hour), mi: Number(p.minute), s: Number(p.second) }
}

// Meia-noite local (y-m-d, mês 1-12, dia pode extrapolar) no fuso tz, em UTC.
export function zonedMidnightUtc(y: number, m: number, d: number, tz: string): Date {
  const target = Date.UTC(y, m - 1, d)
  let guess = target
  for (let i = 0; i < 3; i++) {
    const p = zonedParts(new Date(guess), tz)
    guess = target - (Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - guess)
  }
  return new Date(guess)
}

export interface WindowSpec {
  key: string // balde que recebe o incremento
  checkKeys?: string[] // ROLLING: baldes somados para conferir o teto (inclui `key`)
  end: Date // quando é seguro tentar de novo
  cycle: string // descrição curta p/ log/UI
}

const iso = (d: Date) => d.toISOString()

export function windowSpec(c: CycleConfig, w: Window, now: Date): WindowSpec {
  if (c.mode === 'ROLLING') {
    const step = w === 'H' ? 60_000 : 86_400_000
    const count = w === 'H' ? 60 : 30
    const slice = w === 'H' ? 16 : 10 // minuto | dia (UTC)
    const cur = Math.floor(now.getTime() / step) * step
    const keys = Array.from({ length: count }, (_, i) => iso(new Date(cur - i * step)).slice(0, slice))
    return { key: keys[0], checkKeys: keys, end: new Date(cur + step), cycle: `ROLLING(${count}×${w === 'H' ? 'min' : 'dia'})` }
  }
  if (w === 'H') return { key: iso(now).slice(0, 13), end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours() + 1)), cycle: 'FIXED(hora UTC)' }
  const p = zonedParts(now, c.tz)
  if (c.mode === 'ANCHOR_DAY') {
    const a = c.anchorDay as number
    const startMonth = p.d >= a ? new Date(Date.UTC(p.y, p.m - 1, 1)) : new Date(Date.UTC(p.y, p.m - 2, 1))
    const sy = startMonth.getUTCFullYear(); const sm = startMonth.getUTCMonth() + 1
    const nextMonth = new Date(Date.UTC(sy, sm, 1))
    return { key: `A${a}@${sy}-${pad(sm)}-${pad(a)}`, end: zonedMidnightUtc(nextMonth.getUTCFullYear(), nextMonth.getUTCMonth() + 1, a, c.tz), cycle: `ANCHOR_DAY:${a}(${c.tz})` }
  }
  const nextMonth = new Date(Date.UTC(p.y, p.m, 1))
  // FIXED + UTC mantém o formato de chave antigo (AAAA-MM): contadores existentes continuam valendo.
  return { key: `${p.y}-${pad(p.m)}`, end: zonedMidnightUtc(nextMonth.getUTCFullYear(), nextMonth.getUTCMonth() + 1, 1, c.tz), cycle: `FIXED(mês ${c.tz})` }
}
