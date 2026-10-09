import { useState } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Users, Wallet, Trophy, AlarmClock, ArrowRightLeft } from 'lucide-react'
import { Select } from '../../components/ui/Select'
import * as api from '../../api/reports.api'
import { formatCurrency } from '../../utils/format'
import { ChartBox, CsvButton, Kpi, KpiGrid, ReportState, ReportTable, Section, axisProps, downloadCsv, fmtPct, nf, tooltipStyle, useReport } from './shared'

const KIND: Record<string, string> = { OPEN: 'Em andamento', WON: 'Ganho', LOST: 'Perdido' }

export default function FunilReport({ from, to, users }: { from?: string; to?: string; users: { id: string; name: string }[] }) {
  const [ownerId, setOwnerId] = useState('')
  const { data, loading } = useReport(() => api.funnelReport({ from, to, ownerId: ownerId || undefined }), [from, to, ownerId])

  function exportCsv() {
    if (!data) return
    downloadCsv('relatorio-funil.csv', ['Etapa', 'Tipo', 'Leads', '% do funil', 'Valor', 'Dias médios na etapa', 'Parados', 'Entradas no período'],
      data.stages.map((s) => [s.name, KIND[s.kind], s.count, s.share, s.value, s.avgDaysInStage, s.stuck, s.enteredInPeriod]))
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
              <Kpi icon={Users} label="Leads no funil" value={nf.format(data.totals.leads)} hint={`${nf.format(data.totals.open)} em andamento`} tone="sky" />
              <Kpi icon={Wallet} label="Valor em aberto" value={formatCurrency(data.totals.openValue)} tone="primary" />
              <Kpi icon={Trophy} label="Ganhos / perdidos" value={`${nf.format(data.totals.won)} / ${nf.format(data.totals.lost)}`} hint="no total do funil" tone="green" />
              <Kpi icon={AlarmClock} label="Leads parados" value={nf.format(data.totals.stuck)} hint={`há mais de ${data.totals.stuckDays} dias na mesma etapa`} tone={data.totals.stuck ? 'red' : 'green'} />
            </KpiGrid>

            <Section title="Leads por etapa">
              <ChartBox height={Math.max(220, data.stages.length * 40)}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.stages} layout="vertical" margin={{ left: 8, right: 16 }}>
                    <CartesianGrid horizontal={false} stroke="currentColor" strokeOpacity={0.15} />
                    <XAxis type="number" allowDecimals={false} {...axisProps} />
                    <YAxis type="category" dataKey="name" width={120} {...axisProps} />
                    <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'currentColor', fillOpacity: 0.08 }}
                      formatter={(value, _n, item) => [`${value} lead(s) · ${formatCurrency(Number(item.payload.value))}`, 'Etapa']} />
                    <Bar dataKey="count" radius={[0, 4, 4, 0]}>{data.stages.map((s) => <Cell key={s.id} fill={s.color} />)}</Bar>
                  </BarChart>
                </ResponsiveContainer>
              </ChartBox>
            </Section>

            <Section title="Detalhe por etapa" hint={`Entradas no período = movimentações para a etapa (${nf.format(data.totals.movesInPeriod)} no total).`}>
              <ReportTable rows={data.stages} rowKey={(s) => s.id}
                cols={[
                  { key: 'name', header: 'Etapa', cell: (s) => <span className="inline-flex items-center gap-2 font-medium"><span className="w-2.5 h-2.5 rounded-full" style={{ background: s.color }} />{s.name}</span>, total: 'Total' },
                  { key: 'kind', header: 'Tipo', cell: (s) => KIND[s.kind] },
                  { key: 'count', header: 'Leads', align: 'right', cell: (s) => nf.format(s.count), total: nf.format(data.totals.leads) },
                  { key: 'share', header: '% do funil', align: 'right', cell: (s) => fmtPct(s.share) },
                  { key: 'value', header: 'Valor', align: 'right', cell: (s) => formatCurrency(s.value) },
                  { key: 'days', header: 'Dias médios na etapa', align: 'right', cell: (s) => (s.kind === 'OPEN' ? s.avgDaysInStage.toLocaleString('pt-BR') : '—') },
                  { key: 'stuck', header: 'Parados', align: 'right', cell: (s) => (s.kind === 'OPEN' ? <span className={s.stuck ? 'text-tone-red-solid font-semibold' : ''}>{nf.format(s.stuck)}</span> : '—'), total: nf.format(data.totals.stuck) },
                  { key: 'entered', header: 'Entradas no período', align: 'right', cell: (s) => <span className="inline-flex items-center gap-1"><ArrowRightLeft size={12} className="text-fg-muted" />{nf.format(s.enteredInPeriod)}</span>, total: nf.format(data.totals.movesInPeriod) },
                ]} />
            </Section>

            <Section title="Leads por responsável e etapa">
              <ReportTable rows={data.owners} rowKey={(o) => o.key}
                cols={[
                  { key: 'label', header: 'Responsável', cell: (o) => <span className="font-medium">{o.label}</span> },
                  ...data.stages.map((s) => ({ key: s.id, header: s.name, align: 'right' as const, cell: (o: (typeof data.owners)[number]) => nf.format(o.byStage[s.id] ?? 0) })),
                  { key: 'total', header: 'Total', align: 'right', cell: (o) => <strong>{nf.format(o.total)}</strong> },
                ]} />
            </Section>
          </>
        )}
      </ReportState>
    </>
  )
}
