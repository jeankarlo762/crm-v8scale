import { useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Line, ComposedChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { DollarSign, TrendingUp, Wrench, UserPlus, UserMinus, Users, Receipt, ArrowDownRight } from 'lucide-react'
import { PageHeader } from '../../components/layout/AppLayout'
import { Card } from '../../components/ui/Card'
import { Input } from '../../components/ui/Input'
import { Select } from '../../components/ui/Select'
import { Badge } from '../../components/ui/Badge'
import * as financialApi from '../../api/financial.api'
import type { FinancialOverview } from '../../api/financial.api'
import { formatCompactCurrency, formatCurrency } from '../../utils/format'
import {
  ChartBox, CsvButton, Kpi, KpiGrid, ReportState, ReportTable, Section, axisProps, downloadCsv, fmtDate, tooltipStyle, useReport,
} from '../Relatorios/shared'

const TZ = 'America/Sao_Paulo'
const day = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: TZ })

function presetRange(key: string): { from: string; to: string } {
  const now = new Date()
  const [y, m] = day(now).split('-').map(Number)
  const ymd = (yy: number, mm: number, dd: number) => day(new Date(Date.UTC(yy, mm - 1, dd, 12)))
  const last = (yy: number, mm: number) => new Date(Date.UTC(yy, mm, 0)).getUTCDate()
  switch (key) {
    case 'lastmonth': { const pm = m === 1 ? 12 : m - 1; const py = m === 1 ? y - 1 : y; return { from: ymd(py, pm, 1), to: ymd(py, pm, last(py, pm)) } }
    case 'quarter': { const qm = Math.floor((m - 1) / 3) * 3 + 1; return { from: ymd(y, qm, 1), to: ymd(y, qm + 2, last(y, qm + 2)) } }
    case 'year': return { from: ymd(y, 1, 1), to: ymd(y, 12, 31) }
    default: return { from: ymd(y, m, 1), to: ymd(y, m, last(y, m)) }
  }
}

const PRESETS = [
  { value: 'month', label: 'Este mês' },
  { value: 'lastmonth', label: 'Mês passado' },
  { value: 'quarter', label: 'Este trimestre' },
  { value: 'year', label: 'Este ano' },
  { value: 'custom', label: 'Personalizado' },
]

const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const monthLabel = (key: string) => { const [y, m] = key.split('-'); return `${MONTHS[Number(m) - 1]}/${y.slice(2)}` }

type CustomerRow = FinancialOverview['customers'][number]

export default function FinanceiroPage() {
  const [preset, setPreset] = useState('month')
  const [custom, setCustom] = useState(presetRange('month'))
  const [status, setStatus] = useState<'active' | 'inactive' | 'all'>('active')

  const range = useMemo(() => (preset === 'custom' ? custom : presetRange(preset)), [preset, custom])
  const valid = !!range.from && !!range.to && range.from <= range.to
  const { data, loading } = useReport(
    () => (valid ? financialApi.getOverview(range.from, range.to) : Promise.resolve(null)),
    [range.from, range.to, valid],
  )

  const customers = useMemo(() => {
    const list = data?.customers ?? []
    if (status === 'active') return list.filter((c) => c.active)
    if (status === 'inactive') return list.filter((c) => !c.active)
    return list
  }, [data, status])

  function exportCsv() {
    downloadCsv(
      'financeiro-clientes.csv',
      ['Cliente', 'Situação', 'Vendedor', 'Mensalidade', 'Implantação', 'Cliente desde', 'Cancelou em'],
      customers.map((c) => [
        c.name, c.active ? 'Ativo' : 'Cancelado', c.owner?.name ?? '', c.mrrValue.toFixed(2).replace('.', ','),
        c.setupFee.toFixed(2).replace('.', ','), fmtDate(c.createdAt), c.churnedAt ? fmtDate(c.churnedAt) : '',
      ]),
    )
  }

  const t = data?.totals

  return (
    <div>
      <PageHeader title="Financeiro" subtitle="Receita recorrente (mensalidades) e de implantação dos clientes" />

      <Card className="mb-6" padding={false}>
        <div className="p-4 flex flex-wrap items-end gap-3">
          <div className="w-52"><Select label="Período" value={preset} onChange={(e) => { setPreset(e.target.value); if (e.target.value === 'custom') setCustom(range) }} options={PRESETS} /></div>
          {preset === 'custom' && (
            <>
              <div className="w-44"><Input label="De" type="date" value={custom.from} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} /></div>
              <div className="w-44"><Input label="Até" type="date" value={custom.to} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} /></div>
            </>
          )}
          <p className="text-xs text-fg-muted pb-2.5">MRR, ARR e ticket médio são a foto de hoje; o restante é do período escolhido.</p>
        </div>
      </Card>

      <ReportState loading={loading} hasData={!!data}>
        {data && t && (
          <>
            <KpiGrid>
              <Kpi icon={DollarSign} tone="green" label="MRR (receita mensal)" value={formatCurrency(t.mrr)} hint={`${t.activeCustomers} cliente(s) ativos`} />
              <Kpi icon={TrendingUp} label="ARR (receita anual)" value={formatCurrency(t.arr)} />
              <Kpi icon={Receipt} tone="sky" label="Ticket médio" value={formatCurrency(t.averageTicket)} hint="por cliente ativo" />
              <Kpi icon={Wrench} tone="amber" label="Implantação no período" value={formatCurrency(t.setupRevenue)} hint="receita única" />
              <Kpi icon={UserPlus} tone="purple" label="Novos clientes" value={t.newCustomers} hint={`+${formatCurrency(t.newMrr)} de MRR`} />
              <Kpi icon={UserMinus} tone="red" label="Cancelamentos" value={t.churnedCustomers} hint={t.churnedCustomers ? `-${formatCurrency(t.churnedMrr)} de MRR` : undefined} />
              <Kpi icon={ArrowDownRight} tone="red" label="Churn de receita" value={`${t.mrr + t.churnedMrr > 0 ? ((t.churnedMrr / (t.mrr + t.churnedMrr)) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) : '0'}%`} hint="MRR perdido no período" />
              <Kpi icon={Users} tone="sky" label="MRR líquido no período" value={formatCurrency(t.newMrr - t.churnedMrr)} hint="novos − cancelados" />
            </KpiGrid>

            <div className="grid lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2">
                <Section title="Evolução do MRR" hint="Últimos 12 meses, com a mensalidade atual de cada cliente">
                  <ChartBox height={260}>
                    <ResponsiveContainer>
                      <ComposedChart data={data.series} margin={{ left: 0, right: 8 }}>
                        <CartesianGrid vertical={false} stroke="currentColor" strokeOpacity={0.15} />
                        <XAxis dataKey="month" tickFormatter={monthLabel} {...axisProps} />
                        <YAxis tickFormatter={(v: number) => formatCompactCurrency(v)} width={64} {...axisProps} />
                        <Tooltip
                          contentStyle={tooltipStyle}
                          labelFormatter={(l) => monthLabel(String(l))}
                          formatter={(value, name) => [formatCurrency(Number(value)), name === 'mrr' ? 'MRR' : 'Implantação']}
                        />
                        <Bar dataKey="setupRevenue" fill="#3d97ff" fillOpacity={0.35} radius={[4, 4, 0, 0]} />
                        <Line type="monotone" dataKey="mrr" stroke="#007BFF" strokeWidth={2.5} dot={{ r: 3 }} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </ChartBox>
                </Section>
              </div>
              <Section title="MRR por vendedor" hint="Clientes ativos">
                {data.bySeller.length === 0 ? (
                  <p className="text-sm text-fg-muted py-8 text-center">Nenhum cliente ativo</p>
                ) : (
                  <ChartBox height={260}>
                    <ResponsiveContainer>
                      <BarChart data={data.bySeller} layout="vertical" margin={{ left: 0, right: 8 }}>
                        <CartesianGrid horizontal={false} stroke="currentColor" strokeOpacity={0.15} />
                        <XAxis type="number" tickFormatter={(v: number) => formatCompactCurrency(v)} {...axisProps} />
                        <YAxis type="category" dataKey="name" width={100} {...axisProps} />
                        <Tooltip contentStyle={tooltipStyle} formatter={(value) => [formatCurrency(Number(value)), 'MRR']} />
                        <Bar dataKey="mrr" fill="#007BFF" radius={[0, 4, 4, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </ChartBox>
                )}
              </Section>
            </div>

            <Section
              title="Faturamento por cliente"
              action={
                <div className="flex items-end gap-2">
                  <div className="w-36">
                    <Select
                      value={status}
                      onChange={(e) => setStatus(e.target.value as typeof status)}
                      options={[{ value: 'active', label: 'Ativos' }, { value: 'inactive', label: 'Cancelados' }, { value: 'all', label: 'Todos' }]}
                    />
                  </div>
                  <CsvButton onClick={exportCsv} disabled={customers.length === 0} />
                </div>
              }
            >
              <ReportTable<CustomerRow>
                rows={customers}
                rowKey={(c) => c.id}
                empty="Nenhum cliente nesta situação"
                cols={[
                  {
                    key: 'name', header: 'Cliente',
                    cell: (c) => (
                      <span className="flex items-center gap-2">
                        {c.name}
                        {!c.active && <Badge label="Cancelado" variant="red" />}
                        {c.archived && <Badge label="Arquivado" variant="gray" />}
                      </span>
                    ),
                  },
                  { key: 'owner', header: 'Vendedor', cell: (c) => c.owner?.name ?? '—' },
                  { key: 'since', header: 'Cliente desde', cell: (c) => fmtDate(c.createdAt) },
                  { key: 'churn', header: 'Cancelou em', cell: (c) => (c.churnedAt ? fmtDate(c.churnedAt) : '—') },
                  {
                    key: 'mrr', header: 'Mensalidade', align: 'right',
                    cell: (c) => <span className={c.active ? 'font-semibold text-tone-green-fg' : 'text-fg-muted line-through'}>{formatCurrency(c.mrrValue)}</span>,
                    total: formatCurrency(customers.filter((c) => c.active).reduce((s, c) => s + c.mrrValue, 0)),
                  },
                  {
                    key: 'setup', header: 'Implantação', align: 'right',
                    cell: (c) => formatCurrency(c.setupFee),
                    total: formatCurrency(customers.reduce((s, c) => s + c.setupFee, 0)),
                  },
                ]}
              />
            </Section>
          </>
        )}
      </ReportState>
    </div>
  )
}
