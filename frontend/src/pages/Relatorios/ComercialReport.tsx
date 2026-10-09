import { useState } from 'react'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { UserPlus, Trophy, XCircle, Wallet, Receipt, Percent, Timer, Repeat } from 'lucide-react'
import { Select } from '../../components/ui/Select'
import * as api from '../../api/reports.api'
import type { CommercialGroup } from '../../api/reports.api'
import { formatCompactCurrency, formatCurrency } from '../../utils/format'
import {
  ChartBox, Col, CsvButton, Kpi, KpiGrid, ReportState, ReportTable, Section, axisProps, downloadCsv, fmtDate, fmtPct, nf, shortDay, tooltipStyle, useReport,
} from './shared'

function groupCols(first: string, rows: CommercialGroup[]): Col<CommercialGroup>[] {
  const sum = (k: 'created' | 'won' | 'lost' | 'wonValue' | 'openCount' | 'openValue') => rows.reduce((a, r) => a + r[k], 0)
  return [
    { key: 'label', header: first, cell: (r) => <span className="font-medium">{r.label}</span>, total: 'Total' },
    { key: 'created', header: 'Leads criados', align: 'right', cell: (r) => nf.format(r.created), total: nf.format(sum('created')) },
    { key: 'won', header: 'Ganhos', align: 'right', cell: (r) => nf.format(r.won), total: nf.format(sum('won')) },
    { key: 'lost', header: 'Perdidos', align: 'right', cell: (r) => nf.format(r.lost), total: nf.format(sum('lost')) },
    { key: 'rate', header: 'Taxa de ganho', align: 'right', cell: (r) => fmtPct(r.winRate), total: fmtPct(sum('won') + sum('lost') ? (sum('won') / (sum('won') + sum('lost'))) * 100 : 0) },
    { key: 'value', header: 'Valor ganho', align: 'right', cell: (r) => formatCurrency(r.wonValue), total: formatCurrency(sum('wonValue')) },
    { key: 'open', header: 'Em aberto', align: 'right', cell: (r) => nf.format(r.openCount), total: nf.format(sum('openCount')) },
    { key: 'openValue', header: 'Valor em aberto', align: 'right', cell: (r) => formatCurrency(r.openValue), total: formatCurrency(sum('openValue')) },
  ]
}

export default function ComercialReport({ from, to, users }: { from?: string; to?: string; users: { id: string; name: string }[] }) {
  const [ownerId, setOwnerId] = useState('')
  const { data, loading } = useReport(() => api.commercialReport({ from, to, ownerId: ownerId || undefined }), [from, to, ownerId])

  function exportCsv() {
    if (!data) return
    const rows = [...data.byOwner.map((r) => ['Responsável', r, '']), ...data.bySource.map((r) => ['Origem', r, ''])] as [string, CommercialGroup, string][]
    downloadCsv('relatorio-comercial.csv', ['Tipo', 'Nome', 'Leads criados', 'Ganhos', 'Perdidos', 'Taxa de ganho (%)', 'Valor ganho', 'Em aberto', 'Valor em aberto'],
      rows.map(([t, r]) => [t, r.label, r.created, r.won, r.lost, r.winRate, r.wonValue, r.openCount, r.openValue]))
  }

  return (
    <>
      <div className="flex flex-wrap gap-3 mb-4 items-end">
        <div className="w-56"><Select label="Responsável" value={ownerId} onChange={(e) => setOwnerId(e.target.value)} options={[{ value: '', label: 'Toda a equipe' }, { value: 'none', label: 'Sem responsável' }, ...users.map((u) => ({ value: u.id, label: u.name }))]} /></div>
        <div className="ml-auto"><CsvButton onClick={exportCsv} disabled={!data} /></div>
      </div>
      <ReportState loading={loading} hasData={!!data}>
        {data && (
          <>
            <KpiGrid>
              <Kpi icon={UserPlus} label="Leads criados" value={nf.format(data.kpis.created)} tone="sky" />
              <Kpi icon={Trophy} label="Negócios ganhos" value={nf.format(data.kpis.won)} hint={formatCurrency(data.kpis.wonValue)} tone="green" />
              <Kpi icon={XCircle} label="Perdidos" value={nf.format(data.kpis.lost)} tone="red" />
              <Kpi icon={Percent} label="Taxa de ganho" value={fmtPct(data.kpis.winRate)} hint="ganhos ÷ (ganhos + perdidos)" tone="amber" />
              <Kpi icon={Receipt} label="Ticket médio" value={formatCurrency(data.kpis.avgTicket)} tone="primary" />
              <Kpi icon={Timer} label="Ciclo médio de venda" value={`${data.kpis.avgCycleDays.toLocaleString('pt-BR')} dias`} hint="criação → ganho" tone="purple" />
              <Kpi icon={Wallet} label="Pipeline em aberto" value={formatCurrency(data.kpis.openValue)} hint={`${nf.format(data.kpis.openCount)} lead(s)`} tone="sky" />
              <Kpi icon={Repeat} label="MRR (clientes ativos)" value={formatCurrency(data.kpis.mrr)} hint={`${nf.format(data.kpis.activeCustomers)} ativos · +${data.kpis.newCustomers} novos · ${data.kpis.churned} cancelados`} tone="green" />
            </KpiGrid>

            <Section title="Leads criados e ganhos por dia">
              <ChartBox>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={data.series} margin={{ left: -16, right: 8 }}>
                    <CartesianGrid vertical={false} stroke="currentColor" strokeOpacity={0.15} />
                    <XAxis dataKey="day" tickFormatter={shortDay} {...axisProps} />
                    <YAxis allowDecimals={false} {...axisProps} />
                    <Tooltip contentStyle={tooltipStyle} labelFormatter={(l) => shortDay(String(l))} />
                    <Legend />
                    <Area type="monotone" dataKey="criados" name="Criados" stroke="#0ea5e9" fill="#0ea5e9" fillOpacity={0.15} />
                    <Area type="monotone" dataKey="ganhos" name="Ganhos" stroke="#16a34a" fill="#16a34a" fillOpacity={0.25} />
                  </AreaChart>
                </ResponsiveContainer>
              </ChartBox>
            </Section>

            <Section title="Por responsável"><ReportTable cols={groupCols('Responsável', data.byOwner)} rows={data.byOwner} rowKey={(r) => r.key} /></Section>
            <Section title="Por origem do lead"><ReportTable cols={groupCols('Origem', data.bySource)} rows={data.bySource} rowKey={(r) => r.key} /></Section>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Section title="Motivos de perda">
                {data.lostReasons.length === 0 ? <p className="text-sm text-fg-muted py-6 text-center">Nenhuma perda no período</p> : (
                  <ChartBox height={Math.max(200, data.lostReasons.length * 36)}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={data.lostReasons} layout="vertical" margin={{ left: 8, right: 16 }}>
                        <CartesianGrid horizontal={false} stroke="currentColor" strokeOpacity={0.15} />
                        <XAxis type="number" allowDecimals={false} {...axisProps} />
                        <YAxis type="category" dataKey="reason" width={130} {...axisProps} />
                        <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'currentColor', fillOpacity: 0.08 }} />
                        <Bar dataKey="count" name="Leads" fill="#ef4444" radius={[0, 4, 4, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </ChartBox>
                )}
              </Section>
              <Section title="Últimos negócios ganhos">
                <ReportTable rows={data.recentWins} rowKey={(r) => r.id} empty="Nenhum negócio ganho no período"
                  cols={[
                    { key: 'name', header: 'Lead', cell: (r) => <span className="font-medium">{r.name}</span> },
                    { key: 'owner', header: 'Responsável', cell: (r) => r.owner ?? '—' },
                    { key: 'date', header: 'Data', cell: (r) => fmtDate(r.closedAt) },
                    { key: 'value', header: 'Valor', align: 'right', cell: (r) => formatCompactCurrency(r.value) },
                  ]} />
              </Section>
            </div>
          </>
        )}
      </ReportState>
    </>
  )
}
