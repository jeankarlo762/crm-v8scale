import { prisma } from '../config/database'

// Visão financeira a partir dos Clientes: mensalidade (receita recorrente) e taxa de implantação (receita única,
// contada na data em que o lead virou cliente). Cliente inativo sai do MRR; churnedAt marca quando saiu.

export interface FinancialPeriod {
  start: Date // inclusive
  end: Date // exclusivo
}

// Meses no fuso de Brasília (UTC-3, sem horário de verão): 00:00 BRT = 03:00 UTC.
const BRT_OFFSET_H = 3
const brtMonthStart = (y: number, m: number) => new Date(Date.UTC(y, m, 1, BRT_OFFSET_H))

export async function getFinancialOverview(period: FinancialPeriod, months = 12) {
  const customers = await prisma.customer.findMany({
    select: {
      id: true, name: true, mrrValue: true, setupFee: true, active: true, churnedAt: true, archivedAt: true, createdAt: true,
      lead: { select: { owner: { select: { id: true, name: true } } } },
    },
    orderBy: { createdAt: 'desc' },
  })
  const rows = customers.map((c) => ({ ...c, mrrValue: Number(c.mrrValue), setupFee: Number(c.setupFee) }))
  const inPeriod = (d: Date | null) => !!d && d >= period.start && d < period.end

  const active = rows.filter((c) => c.active)
  const mrr = active.reduce((s, c) => s + c.mrrValue, 0)
  const newInPeriod = rows.filter((c) => inPeriod(c.createdAt))
  const churnedInPeriod = rows.filter((c) => !c.active && inPeriod(c.churnedAt))

  // MRR no fim de cada mês, reconstruído com a mensalidade atual de cada cliente (não há histórico de reajuste).
  const nowBrt = new Date(Date.now() - BRT_OFFSET_H * 3600_000)
  const series = []
  for (let i = months - 1; i >= 0; i--) {
    const y = nowBrt.getUTCFullYear()
    const m = nowBrt.getUTCMonth() - i
    const monthStart = brtMonthStart(y, m)
    const monthEnd = brtMonthStart(y, m + 1)
    const alive = rows.filter((c) => c.createdAt < monthEnd && (c.active || (!!c.churnedAt && c.churnedAt >= monthEnd)))
    series.push({
      month: `${monthStart.getUTCFullYear()}-${String(monthStart.getUTCMonth() + 1).padStart(2, '0')}`,
      mrr: alive.reduce((s, c) => s + c.mrrValue, 0),
      setupRevenue: rows.filter((c) => c.createdAt >= monthStart && c.createdAt < monthEnd).reduce((s, c) => s + c.setupFee, 0),
      newCustomers: rows.filter((c) => c.createdAt >= monthStart && c.createdAt < monthEnd).length,
      churned: rows.filter((c) => !c.active && c.churnedAt && c.churnedAt >= monthStart && c.churnedAt < monthEnd).length,
    })
  }

  // Receita recorrente por vendedor (clientes ativos).
  const bySeller = new Map<string, { ownerId: string | null; name: string; customers: number; mrr: number }>()
  for (const c of active) {
    const key = c.lead.owner?.id ?? 'none'
    const cur = bySeller.get(key) ?? { ownerId: c.lead.owner?.id ?? null, name: c.lead.owner?.name ?? 'Sem vendedor', customers: 0, mrr: 0 }
    cur.customers += 1
    cur.mrr += c.mrrValue
    bySeller.set(key, cur)
  }

  return {
    totals: {
      mrr,
      arr: mrr * 12,
      activeCustomers: active.length,
      averageTicket: active.length ? mrr / active.length : 0,
      setupRevenue: newInPeriod.reduce((s, c) => s + c.setupFee, 0),
      newCustomers: newInPeriod.length,
      newMrr: newInPeriod.filter((c) => c.active).reduce((s, c) => s + c.mrrValue, 0),
      churnedCustomers: churnedInPeriod.length,
      churnedMrr: churnedInPeriod.reduce((s, c) => s + c.mrrValue, 0),
    },
    series,
    bySeller: [...bySeller.values()].sort((a, b) => b.mrr - a.mrr),
    customers: rows.map((c) => ({
      id: c.id,
      name: c.name,
      active: c.active,
      archived: !!c.archivedAt,
      mrrValue: c.mrrValue,
      setupFee: c.setupFee,
      createdAt: c.createdAt,
      churnedAt: c.churnedAt,
      owner: c.lead.owner,
    })),
  }
}
