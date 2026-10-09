import { useState } from 'react'
import { Area, AreaChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Megaphone, Send, MessageCircle, Percent, UserPlus, Trophy, Info } from 'lucide-react'
import { Badge } from '../../components/ui/Badge'
import { Modal } from '../../components/ui/Modal'
import { Select } from '../../components/ui/Select'
import { Spinner } from '../../components/ui/Spinner'
import * as api from '../../api/reports.api'
import type { CampaignReportRow, CampaignRecipientRow } from '../../api/reports.api'
import { formatCurrency, formatPhone } from '../../utils/format'
import {
  ChartBox, Col, CsvButton, Kpi, KpiGrid, ReportState, ReportTable, Section, axisProps, downloadCsv, fmtDate, fmtDateTime, fmtPct, nf, shortDay, tooltipStyle, useReport,
} from './shared'

export const CAMPAIGN_STATUS: Record<string, { label: string; variant: 'gray' | 'sky' | 'yellow' | 'green' }> = {
  DRAFT: { label: 'Rascunho', variant: 'gray' },
  RUNNING: { label: 'Em andamento', variant: 'sky' },
  PAUSED: { label: 'Pausada', variant: 'yellow' },
  DONE: { label: 'Concluída', variant: 'green' },
}
export const PROSPECT_STATUS: Record<string, string> = {
  nao_contatado: 'Não contatado', contato_1: 'Contato 1', contato_2: 'Contato 2', contato_3: 'Contato 3',
  sem_retorno: 'Sem retorno', negociando: 'Negociando', fechado: 'Fechado', recusado: 'Recusado',
}
const RECIPIENT_STATUS: Record<string, string> = { PENDING: 'Na fila', SENT: 'Enviada', FAILED: 'Falhou', SKIPPED: 'Ignorada' }

export default function CampanhasReport({ from, to, users }: { from?: string; to?: string; users: { id: string; name: string }[] }) {
  const [responsavelId, setResponsavelId] = useState('')
  const [open, setOpen] = useState<CampaignReportRow | null>(null)
  const { data, loading } = useReport(
    () => api.campaignsReport({ from, to, responsavelId: responsavelId || undefined }),
    [from, to, responsavelId],
  )

  const cols: Col<CampaignReportRow>[] = [
    { key: 'name', header: 'Campanha', cell: (c) => <span className="font-medium">{c.name}</span>, total: 'Total' },
    { key: 'status', header: 'Situação', cell: (c) => <Badge label={CAMPAIGN_STATUS[c.status]?.label ?? c.status} variant={CAMPAIGN_STATUS[c.status]?.variant ?? 'gray'} /> },
    { key: 'resp', header: 'Responsável', cell: (c) => c.responsavel?.name ?? '—' },
    { key: 'created', header: 'Criada em', cell: (c) => fmtDate(c.createdAt) },
    { key: 'total', header: 'Destinatários', align: 'right', cell: (c) => nf.format(c.total), total: nf.format(data?.totals.total ?? 0) },
    { key: 'sent', header: 'Enviadas', align: 'right', cell: (c) => nf.format(c.sent), total: nf.format(data?.totals.sent ?? 0) },
    { key: 'replied', header: 'Chamaram', align: 'right', cell: (c) => <span className="font-semibold text-tone-green-solid">{nf.format(c.replied)}</span>, total: nf.format(data?.totals.replied ?? 0) },
    { key: 'rate', header: 'Taxa de resposta', align: 'right', cell: (c) => fmtPct(c.replyRate), total: fmtPct(data?.totals.replyRate ?? 0) },
    { key: 'neg', header: 'Negociando', align: 'right', cell: (c) => nf.format(c.negotiating), total: nf.format(data?.totals.negotiating ?? 0) },
    { key: 'leads', header: 'Viraram lead', align: 'right', cell: (c) => nf.format(c.leads), total: nf.format(data?.totals.leads ?? 0) },
    { key: 'won', header: 'Ganhos (R$)', align: 'right', cell: (c) => formatCurrency(c.wonValue), total: formatCurrency(data?.totals.wonValue ?? 0) },
    { key: 'failed', header: 'Falhas', align: 'right', cell: (c) => nf.format(c.failed + c.skipped), total: nf.format((data?.totals.failed ?? 0) + (data?.totals.skipped ?? 0)) },
  ]

  function exportCsv() {
    if (!data) return
    downloadCsv('relatorio-campanhas.csv',
      ['Campanha', 'Situação', 'Responsável', 'Criada em', 'Destinatários', 'Enviadas', 'Chamaram', 'Taxa de resposta (%)', 'Negociando', 'Viraram lead', 'Ganhos (R$)', 'Falhas/ignoradas'],
      data.campaigns.map((c) => [c.name, CAMPAIGN_STATUS[c.status]?.label ?? c.status, c.responsavel?.name, fmtDate(c.createdAt), c.total, c.sent, c.replied, c.replyRate, c.negotiating, c.leads, c.wonValue, c.failed + c.skipped]))
  }

  return (
    <>
      <div className="flex flex-wrap gap-3 mb-4 items-end">
        <div className="w-52"><Select label="Responsável" value={responsavelId} onChange={(e) => setResponsavelId(e.target.value)} options={[{ value: '', label: 'Todos' }, ...users.map((u) => ({ value: u.id, label: u.name }))]} /></div>
        <div className="ml-auto"><CsvButton onClick={exportCsv} disabled={!data?.campaigns.length} /></div>
      </div>

      <div className="flex gap-2 items-start text-xs text-fg-muted bg-surface-hover rounded-lg p-3 mb-6">
        <Info size={14} className="mt-0.5 shrink-0" />
        <p>
          <strong className="text-fg">Chamaram</strong> = contatos que responderam a mensagem da campanha no WhatsApp conectado. A contagem começa a partir da
          ativação do rastreio de respostas (respostas anteriores não foram registradas) e só vale enquanto o WhatsApp da campanha estiver conectado.
          Uma resposta conta até 30 dias depois do envio.
        </p>
      </div>

      <ReportState loading={loading} hasData={!!data}>
        {data && (
          <>
            <KpiGrid>
              <Kpi icon={Megaphone} label="Campanhas" value={nf.format(data.totals.campaigns)} tone="sky" />
              <Kpi icon={Send} label="Mensagens enviadas" value={nf.format(data.totals.sent)} hint={`${nf.format(data.totals.total)} destinatários`} tone="primary" />
              <Kpi icon={MessageCircle} label="Clientes que chamaram" value={nf.format(data.totals.replied)} hint={`${nf.format(data.totals.replies)} mensagens recebidas`} tone="green" />
              <Kpi icon={Percent} label="Taxa de resposta" value={fmtPct(data.totals.replyRate)} tone="amber" />
              <Kpi icon={UserPlus} label="Viraram lead" value={nf.format(data.totals.leads)} hint={fmtPct(data.totals.conversionRate) + ' dos enviados'} tone="purple" />
              <Kpi icon={Trophy} label="Fechados" value={nf.format(data.totals.leadsWon)} hint={formatCurrency(data.totals.wonValue)} tone="green" />
            </KpiGrid>

            <Section title="Envios e respostas por dia">
              <ChartBox>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={data.series} margin={{ left: -16, right: 8 }}>
                    <CartesianGrid vertical={false} stroke="currentColor" strokeOpacity={0.15} />
                    <XAxis dataKey="day" tickFormatter={shortDay} {...axisProps} />
                    <YAxis allowDecimals={false} {...axisProps} />
                    <Tooltip contentStyle={tooltipStyle} labelFormatter={(l) => shortDay(String(l))} />
                    <Legend />
                    <Area type="monotone" dataKey="enviadas" name="Enviadas" stroke="#f97316" fill="#f97316" fillOpacity={0.15} />
                    <Area type="monotone" dataKey="respostas" name="Chamaram" stroke="#16a34a" fill="#16a34a" fillOpacity={0.25} />
                  </AreaChart>
                </ResponsiveContainer>
              </ChartBox>
            </Section>

            <Section title="Campanhas" hint="Clique numa campanha para ver quem chamou.">
              <ReportTable cols={cols} rows={data.campaigns} rowKey={(c) => c.id} onRowClick={setOpen} empty="Nenhuma campanha no período" />
            </Section>

            <Section title="Por responsável">
              <ReportTable
                rows={data.byUser}
                rowKey={(u) => u.userId ?? '_none'}
                cols={[
                  { key: 'name', header: 'Responsável', cell: (u) => <span className="font-medium">{u.name}</span>, total: 'Total' },
                  { key: 'campaigns', header: 'Campanhas', align: 'right', cell: (u) => nf.format(u.campaigns), total: nf.format(data.totals.campaigns) },
                  { key: 'sent', header: 'Enviadas', align: 'right', cell: (u) => nf.format(u.sent), total: nf.format(data.totals.sent) },
                  { key: 'replied', header: 'Chamaram', align: 'right', cell: (u) => nf.format(u.replied), total: nf.format(data.totals.replied) },
                  { key: 'rate', header: 'Taxa de resposta', align: 'right', cell: (u) => fmtPct(u.replyRate), total: fmtPct(data.totals.replyRate) },
                  { key: 'leads', header: 'Viraram lead', align: 'right', cell: (u) => nf.format(u.leads), total: nf.format(data.totals.leads) },
                  { key: 'won', header: 'Ganhos (R$)', align: 'right', cell: (u) => formatCurrency(u.wonValue), total: formatCurrency(data.totals.wonValue) },
                ]}
              />
            </Section>
          </>
        )}
      </ReportState>

      {open && <RecipientsModal campaign={open} onClose={() => setOpen(null)} />}
    </>
  )
}

function RecipientsModal({ campaign, onClose }: { campaign: CampaignReportRow; onClose: () => void }) {
  const [onlyReplied, setOnlyReplied] = useState(true)
  const { data, loading } = useReport(() => api.campaignRecipients(campaign.id, onlyReplied), [campaign.id, onlyReplied])

  const cols: Col<CampaignRecipientRow>[] = [
    { key: 'name', header: 'Contato', cell: (r) => <div><p className="font-medium">{r.name}</p>{r.prospect && r.prospect.arenaName !== r.name && <p className="text-xs text-fg-muted">{r.prospect.arenaName}</p>}</div> },
    { key: 'phone', header: 'Telefone', cell: (r) => (r.phone.startsWith('+') ? r.phone : formatPhone(r.phone)) },
    { key: 'city', header: 'Cidade', cell: (r) => [r.prospect?.city, r.prospect?.state].filter(Boolean).join(' / ') || '—' },
    { key: 'sent', header: 'Enviada em', cell: (r) => (r.sentAt ? fmtDateTime(r.sentAt) : RECIPIENT_STATUS[r.status] ?? r.status) },
    { key: 'reply', header: 'Chamou em', cell: (r) => (r.repliedAt ? <span className="text-tone-green-solid font-medium">{fmtDateTime(r.repliedAt)}{r.replyCount > 1 ? ` · ${r.replyCount} msgs` : ''}</span> : '—') },
    { key: 'status', header: 'Situação', cell: (r) => (r.prospect ? PROSPECT_STATUS[r.prospect.status] ?? r.prospect.status : '—') },
    { key: 'lead', header: 'No funil', cell: (r) => (r.prospect?.convertedLead ? `${r.prospect.convertedLead.stage.name}${r.prospect.convertedLead.value ? ` · ${formatCurrency(r.prospect.convertedLead.value)}` : ''}` : '—') },
  ]

  return (
    <Modal open onClose={onClose} title={`Campanha: ${campaign.name}`} size="xl">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex rounded-lg border border-border overflow-hidden text-sm">
          {[{ v: true, l: `Chamaram (${campaign.replied})` }, { v: false, l: `Todos (${campaign.total})` }].map((o) => (
            <button key={String(o.v)} type="button" onClick={() => setOnlyReplied(o.v)}
              className={`px-3 py-1.5 ${onlyReplied === o.v ? 'bg-orange-500 text-white' : 'text-fg-muted hover:bg-surface-hover'}`}>{o.l}</button>
          ))}
        </div>
        <CsvButton
          disabled={!data?.recipients.length}
          onClick={() => data && downloadCsv(`campanha-${campaign.name}.csv`,
            ['Contato', 'Telefone', 'Cidade', 'UF', 'Enviada em', 'Chamou em', 'Mensagens recebidas', 'Situação', 'Etapa no funil', 'Valor'],
            data.recipients.map((r) => [r.name, r.phone, r.prospect?.city, r.prospect?.state, fmtDateTime(r.sentAt), fmtDateTime(r.repliedAt), r.replyCount, r.prospect ? PROSPECT_STATUS[r.prospect.status] : '', r.prospect?.convertedLead?.stage.name, r.prospect?.convertedLead?.value]))}
        />
      </div>
      {loading && !data ? <div className="flex justify-center py-10"><Spinner /></div> : (
        <ReportTable cols={cols} rows={data?.recipients ?? []} rowKey={(r) => r.id} empty={onlyReplied ? 'Ninguém respondeu esta campanha (ainda)' : 'Sem destinatários'} />
      )}
    </Modal>
  )
}
