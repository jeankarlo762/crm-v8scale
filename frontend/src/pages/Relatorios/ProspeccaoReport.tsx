import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Target, MessageCircle, Send, Handshake, UserPlus, Search } from 'lucide-react'
import * as api from '../../api/reports.api'
import type { CountRow } from '../../api/reports.api'
import {
  ChartBox, CsvButton, Kpi, KpiGrid, ReportState, ReportTable, Section, axisProps, downloadCsv, fmtPct, nf, shortDay, tooltipStyle, useReport,
} from './shared'
import { PROSPECT_STATUS } from './CampanhasReport'
import { Area, AreaChart } from 'recharts'

const SITE: Record<string, string> = {
  sem_site: 'Sem site', so_instagram: 'Só Instagram', so_facebook: 'Só Facebook', link_bio: 'Link na bio', so_ota: 'Só plataforma de reservas',
  site_proprio: 'Site próprio', fora_do_ar: 'Site fora do ar', sem_https: 'Sem HTTPS', certificado_invalido: 'Certificado inválido', verificar: 'Verificar',
}
const DECISION: Record<string, string> = {
  HAS_WEBSITE: 'Tem site', PROBABLY_NO_WEBSITE: 'Provavelmente sem site', SOCIAL_ONLY: 'Só rede social', UNKNOWN: 'Não confirmado', CONFLICT: 'Conflito', '—': 'Ainda não classificado',
}

function Bars({ rows, color = '#f97316', labelWidth = 150 }: { rows: CountRow[]; color?: string; labelWidth?: number }) {
  if (rows.length === 0) return <p className="text-sm text-fg-muted py-6 text-center">Sem dados</p>
  return (
    <ChartBox height={Math.max(180, rows.length * 34)}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout="vertical" margin={{ left: 8, right: 24 }}>
          <CartesianGrid horizontal={false} stroke="currentColor" strokeOpacity={0.15} />
          <XAxis type="number" allowDecimals={false} {...axisProps} />
          <YAxis type="category" dataKey="label" width={labelWidth} {...axisProps} />
          <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'currentColor', fillOpacity: 0.08 }} />
          <Bar dataKey="count" name="Prospects" fill={color} radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </ChartBox>
  )
}

export default function ProspeccaoReport({ from, to }: { from?: string; to?: string }) {
  const { data, loading } = useReport(() => api.prospectingReport({ from, to }), [from, to])

  function exportCsv() {
    if (!data) return
    downloadCsv('relatorio-prospeccao.csv', ['Nicho', 'Prospects', 'Com WhatsApp', 'Contatados', 'Negociando', 'Fechados', 'Viraram lead'],
      data.byNicho.map((n) => [n.label, n.total, n.withWhatsapp, n.contacted, n.negotiating, n.closed, n.converted]))
  }

  return (
    <ReportState loading={loading} hasData={!!data}>
      {data && (
        <>
          <div className="flex justify-end mb-4"><CsvButton onClick={exportCsv} /></div>
          <KpiGrid>
            <Kpi icon={Target} label="Prospects no período" value={nf.format(data.totals.inPeriod)} hint={`${nf.format(data.totals.prospects)} na base toda`} tone="sky" />
            <Kpi icon={MessageCircle} label="Com WhatsApp" value={nf.format(data.totals.withWhatsapp)} hint={fmtPct(data.totals.inPeriod ? (data.totals.withWhatsapp / data.totals.inPeriod) * 100 : 0)} tone="green" />
            <Kpi icon={Send} label="Contatados" value={nf.format(data.totals.contacted)} hint={`${nf.format(data.totals.replied)} responderam`} tone="primary" />
            <Kpi icon={Handshake} label="Negociando / fechados" value={`${nf.format(data.totals.negotiating)} / ${nf.format(data.totals.closed)}`} tone="amber" />
            <Kpi icon={UserPlus} label="Viraram lead" value={nf.format(data.totals.converted)} tone="purple" />
            <Kpi icon={Search} label="Buscas no Google" value={nf.format(data.totals.searches)} hint={`${nf.format(data.totals.apiCalls)} chamadas à API`} tone="red" />
          </KpiGrid>

          <Section title="Funil da prospecção" hint="De todos os prospects até os que viraram lead do funil.">
            <ChartBox height={Math.max(200, data.funnel.length * 44)}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.funnel} layout="vertical" margin={{ left: 8, right: 24 }}>
                  <CartesianGrid horizontal={false} stroke="currentColor" strokeOpacity={0.15} />
                  <XAxis type="number" allowDecimals={false} {...axisProps} />
                  <YAxis type="category" dataKey="label" width={170} {...axisProps} />
                  <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'currentColor', fillOpacity: 0.08 }} />
                  <Bar dataKey="count" name="Prospects" radius={[0, 4, 4, 0]}>
                    {data.funnel.map((f, i) => <Cell key={f.key} fill={['#0ea5e9', '#14b8a6', '#f97316', '#16a34a', '#a855f7', '#6366f1'][i % 6]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </ChartBox>
          </Section>

          <Section title="Novos prospects por dia">
            <ChartBox height={200}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data.series} margin={{ left: -16, right: 8 }}>
                  <CartesianGrid vertical={false} stroke="currentColor" strokeOpacity={0.15} />
                  <XAxis dataKey="day" tickFormatter={shortDay} {...axisProps} />
                  <YAxis allowDecimals={false} {...axisProps} />
                  <Tooltip contentStyle={tooltipStyle} labelFormatter={(l) => shortDay(String(l))} />
                  <Area type="monotone" dataKey="novos" name="Novos" stroke="#0ea5e9" fill="#0ea5e9" fillOpacity={0.2} />
                </AreaChart>
              </ResponsiveContainer>
            </ChartBox>
          </Section>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Section title="Por status de contato"><Bars rows={data.byStatus.map((s) => ({ ...s, label: PROSPECT_STATUS[s.key] ?? s.key }))} /></Section>
            <Section title="Situação do site"><Bars color="#0ea5e9" rows={data.bySite.map((s) => ({ ...s, label: SITE[s.key] ?? s.label }))} /></Section>
            <Section title="Decisão sobre ter site" hint="Resultado da investigação automática."><Bars color="#a855f7" rows={data.byWebsiteDecision.map((s) => ({ ...s, label: DECISION[s.key] ?? s.label }))} /></Section>
            <Section title="Por estado (top 15)"><Bars color="#14b8a6" labelWidth={60} rows={data.byState.map((s) => ({ ...s, label: s.key === '—' ? 'Sem UF' : s.label }))} /></Section>
          </div>

          <Section title="Por nicho">
            <ReportTable rows={data.byNicho} rowKey={(n) => n.key}
              cols={[
                { key: 'label', header: 'Nicho', cell: (n) => <span className="font-medium">{n.label}</span> },
                { key: 'total', header: 'Prospects', align: 'right', cell: (n) => nf.format(n.total) },
                { key: 'wa', header: 'Com WhatsApp', align: 'right', cell: (n) => nf.format(n.withWhatsapp) },
                { key: 'contacted', header: 'Contatados', align: 'right', cell: (n) => nf.format(n.contacted) },
                { key: 'neg', header: 'Negociando', align: 'right', cell: (n) => nf.format(n.negotiating) },
                { key: 'closed', header: 'Fechados', align: 'right', cell: (n) => nf.format(n.closed) },
                { key: 'conv', header: 'Viraram lead', align: 'right', cell: (n) => nf.format(n.converted) },
              ]} />
          </Section>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Section title="Por responsável">
              <ReportTable rows={data.byResponsavel} rowKey={(n) => n.key}
                cols={[
                  { key: 'label', header: 'Responsável', cell: (n) => <span className="font-medium">{n.label}</span> },
                  { key: 'total', header: 'Prospects', align: 'right', cell: (n) => nf.format(n.total) },
                  { key: 'contacted', header: 'Contatados', align: 'right', cell: (n) => nf.format(n.contacted) },
                  { key: 'neg', header: 'Negociando', align: 'right', cell: (n) => nf.format(n.negotiating) },
                  { key: 'closed', header: 'Fechados', align: 'right', cell: (n) => nf.format(n.closed) },
                ]} />
            </Section>
          </div>
        </>
      )}
    </ReportState>
  )
}
