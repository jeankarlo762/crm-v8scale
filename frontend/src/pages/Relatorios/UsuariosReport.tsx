import { Users, UserCheck, ShieldCheck, Briefcase, Mail, Phone, CalendarClock, LogIn } from 'lucide-react'
import { Badge } from '../../components/ui/Badge'
import { Card } from '../../components/ui/Card'
import * as api from '../../api/reports.api'
import type { UserReportRow } from '../../api/reports.api'
import { formatCurrency, formatPhone } from '../../utils/format'
import { CsvButton, Kpi, KpiGrid, ReportState, Section, downloadCsv, fmtDate, fmtDateTime, fmtPct, nf, useReport } from './shared'

const ROLE: Record<UserReportRow['role'], { label: string; variant: 'purple' | 'sky' | 'gray' }> = {
  ADMIN: { label: 'Administrador', variant: 'purple' },
  MANAGER: { label: 'Gerente', variant: 'sky' },
  SELLER: { label: 'Vendedor', variant: 'gray' },
}
const ACTIVITY: Record<string, string> = { NOTE: 'Notas', CALL: 'Ligações', WHATSAPP: 'WhatsApp', EMAIL: 'E-mails', MEETING: 'Reuniões' }

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: 'red' | 'green' }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] text-fg-muted leading-tight">{label}</p>
      <p className={`text-sm font-semibold tabular-nums truncate ${tone === 'red' ? 'text-tone-red-solid' : tone === 'green' ? 'text-tone-green-solid' : 'text-fg'}`}>{value}</p>
    </div>
  )
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-border pt-3">
      <p className="text-[11px] font-semibold text-fg-muted uppercase tracking-wide mb-2">{title}</p>
      <div className="grid grid-cols-3 gap-x-3 gap-y-2">{children}</div>
    </div>
  )
}

function UserCard({ u }: { u: UserReportRow }) {
  const acts = Object.entries(ACTIVITY).map(([k, label]) => `${label}: ${u.activities.byType[k] ?? 0}`).join(' · ')
  return (
    <Card className={u.active ? '' : 'opacity-70'}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-semibold text-fg truncate">{u.name}</h3>
          <div className="flex items-center gap-1.5 mt-1"><Badge label={ROLE[u.role].label} variant={ROLE[u.role].variant} /><Badge label={u.active ? 'Ativo' : 'Inativo'} variant={u.active ? 'green' : 'gray'} /></div>
        </div>
      </div>
      <ul className="mt-3 mb-3 space-y-1 text-xs text-fg-muted">
        <li className="flex items-center gap-1.5 min-w-0"><Mail size={12} className="shrink-0" /><span className="truncate">{u.email}</span></li>
        <li className="flex items-center gap-1.5"><Phone size={12} className="shrink-0" />{u.phone ? formatPhone(u.phone) : 'Sem telefone'}</li>
        <li className="flex items-center gap-1.5"><CalendarClock size={12} className="shrink-0" />Cadastrado em {fmtDate(u.createdAt)}</li>
        <li className="flex items-center gap-1.5"><LogIn size={12} className="shrink-0" />Última atividade: {u.lastActivityAt ? fmtDateTime(u.lastActivityAt) : 'sem registro'}</li>
      </ul>
      <div className="space-y-3">
        <Group title="Leads">
          <Stat label="Com ele hoje" value={nf.format(u.leads.owned)} />
          <Stat label="Em aberto" value={nf.format(u.leads.open)} />
          <Stat label="Valor em aberto" value={formatCurrency(u.leads.openValue)} />
          <Stat label="Criados (período)" value={nf.format(u.leads.created)} />
          <Stat label="Ganhos (período)" value={nf.format(u.leads.won)} tone="green" />
          <Stat label="Perdidos (período)" value={nf.format(u.leads.lost)} tone={u.leads.lost ? 'red' : undefined} />
          <Stat label="Valor ganho" value={formatCurrency(u.leads.wonValue)} tone="green" />
          <Stat label="Taxa de ganho" value={fmtPct(u.leads.winRate)} />
        </Group>
        <Group title={`Contatos registrados (${nf.format(u.activities.total)})`}>
          <p className="col-span-3 text-xs text-fg">{acts}</p>
        </Group>
        <Group title="Tarefas">
          <Stat label="Em aberto" value={nf.format(u.tasks.open)} />
          <Stat label="Atrasadas" value={nf.format(u.tasks.overdue)} tone={u.tasks.overdue ? 'red' : undefined} />
          <Stat label="Concluídas (período)" value={nf.format(u.tasks.done)} />
        </Group>
        <Group title="Prospecção">
          <Stat label="Prospects dele" value={nf.format(u.prospects.total)} />
          <Stat label="Negociando" value={nf.format(u.prospects.negotiating)} />
          <Stat label="Fechados" value={nf.format(u.prospects.closed)} tone="green" />
        </Group>
        <Group title="Campanhas (período)">
          <Stat label="Campanhas" value={nf.format(u.campaigns.count)} />
          <Stat label="Enviadas" value={nf.format(u.campaigns.sent)} />
          <Stat label="Chamaram" value={`${nf.format(u.campaigns.replied)} (${fmtPct(u.campaigns.replyRate)})`} tone="green" />
        </Group>
        <Group title="Metas">
          <Stat label="Metas vigentes" value={nf.format(u.goalsActive)} />
        </Group>
      </div>
    </Card>
  )
}

export default function UsuariosReport({ from, to }: { from?: string; to?: string }) {
  const { data, loading } = useReport(() => api.usersReport({ from, to }), [from, to])

  function exportCsv() {
    if (!data) return
    downloadCsv('relatorio-usuarios.csv',
      ['Nome', 'E-mail', 'Telefone', 'Perfil', 'Situação', 'Cadastrado em', 'Última atividade', 'Leads com ele', 'Leads em aberto', 'Valor em aberto', 'Leads criados', 'Leads ganhos', 'Valor ganho', 'Leads perdidos', 'Taxa de ganho (%)', 'Contatos registrados', 'Tarefas abertas', 'Tarefas atrasadas', 'Tarefas concluídas', 'Prospects', 'Prospects negociando', 'Prospects fechados', 'Campanhas', 'Enviadas', 'Chamaram', 'Taxa de resposta (%)', 'Metas vigentes'],
      data.users.map((u) => [u.name, u.email, u.phone, ROLE[u.role].label, u.active ? 'Ativo' : 'Inativo', fmtDate(u.createdAt), fmtDateTime(u.lastActivityAt), u.leads.owned, u.leads.open, u.leads.openValue, u.leads.created, u.leads.won, u.leads.wonValue, u.leads.lost, u.leads.winRate, u.activities.total, u.tasks.open, u.tasks.overdue, u.tasks.done, u.prospects.total, u.prospects.negotiating, u.prospects.closed, u.campaigns.count, u.campaigns.sent, u.campaigns.replied, u.campaigns.replyRate, u.goalsActive]))
  }

  return (
    <ReportState loading={loading} hasData={!!data}>
      {data && (
        <>
          <KpiGrid>
            <Kpi icon={Users} label="Usuários" value={nf.format(data.totals.users)} tone="sky" />
            <Kpi icon={UserCheck} label="Ativos" value={nf.format(data.totals.active)} tone="green" />
            <Kpi icon={ShieldCheck} label="Administradores / gerentes" value={`${data.totals.byRole.ADMIN} / ${data.totals.byRole.MANAGER}`} tone="purple" />
            <Kpi icon={Briefcase} label="Vendedores" value={nf.format(data.totals.byRole.SELLER)} tone="primary" />
          </KpiGrid>
          <Section title="Todos os usuários" hint="Os números marcados como (período) seguem o filtro de datas; os demais são a situação de hoje." action={<CsvButton onClick={exportCsv} />}>
            <div className="grid grid-cols-1 xl:grid-cols-2 2xl:grid-cols-3 gap-4">
              {data.users.map((u) => <UserCard key={u.id} u={u} />)}
            </div>
          </Section>
        </>
      )}
    </ReportState>
  )
}
