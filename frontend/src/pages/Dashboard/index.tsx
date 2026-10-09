import { useEffect, useState, type ReactNode } from 'react'
import toast from 'react-hot-toast'
import { Link } from 'react-router-dom'
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { Users, Wallet, UserPlus, Trophy, Percent, AlarmClock, type LucideIcon } from 'lucide-react'
import { PageHeader } from '../../components/layout/AppLayout'
import { Card } from '../../components/ui/Card'
import { Select } from '../../components/ui/Select'
import { Spinner } from '../../components/ui/Spinner'
import * as api from '../../api/commercial.api'
import { useAuthStore } from '../../store/auth.store'
import { errMsg } from '../../utils/apiError'
import { formatCompactCurrency, formatCurrency } from '../../utils/format'
import type { DashboardData } from '../../types'

const PERIODS = [
  { value: '7', label: 'Últimos 7 dias' },
  { value: '30', label: 'Últimos 30 dias' },
  { value: '90', label: 'Últimos 90 dias' },
]

const tooltipStyle = {
  background: 'rgb(var(--surface))',
  border: '1px solid rgb(var(--border))',
  borderRadius: 8,
  color: 'rgb(var(--fg))',
  fontSize: 12,
}

function Kpi({ icon: Icon, label, value, hint, tone = 'primary' }: {
  icon: LucideIcon
  label: string
  value: ReactNode
  hint?: ReactNode
  tone?: 'primary' | 'green' | 'sky' | 'amber' | 'purple' | 'red'
}) {
  const tones: Record<string, string> = {
    primary: 'bg-primary-soft text-primary-soft-fg',
    green: 'bg-tone-green-bg text-tone-green-fg',
    sky: 'bg-tone-sky-bg text-tone-sky-fg',
    amber: 'bg-tone-amber-bg text-tone-amber-fg',
    purple: 'bg-tone-purple-bg text-tone-purple-fg',
    red: 'bg-tone-red-bg text-tone-red-fg',
  }
  return (
    <Card className="flex items-start gap-4">
      <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${tones[tone]}`}>
        <Icon size={20} />
      </div>
      <div className="min-w-0">
        <p className="text-sm text-fg-muted">{label}</p>
        <p className="text-2xl font-bold text-fg mt-0.5 truncate">{value}</p>
        {hint && <p className="text-xs text-fg-muted mt-1">{hint}</p>}
      </div>
    </Card>
  )
}

function shortDate(iso: string): string {
  const [, m, d] = iso.split('-')
  return `${d}/${m}`
}

export default function DashboardPage() {
  const user = useAuthStore((s) => s.user)
  const [days, setDays] = useState('30')
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    api
      .getDashboard(Number(days))
      .then((d) => { if (!cancelled) setData(d) })
      .catch((err) => toast.error(errMsg(err) ?? 'Erro ao carregar o dashboard'))
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [days])

  const k = data?.kpis
  const firstName = user?.name.split(' ')[0]

  return (
    <>
      <PageHeader
        title={`Olá${firstName ? `, ${firstName}` : ''}`}
        subtitle="Visão geral do comercial"
        action={<div className="w-48"><Select aria-label="Período" value={days} onChange={(e) => setDays(e.target.value)} options={PERIODS} /></div>}
      />

      {loading && !data ? (
        <div className="flex justify-center py-20"><Spinner size="lg" className="text-orange-500" /></div>
      ) : data && k ? (
        <div className={loading ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 mb-6">
            <Kpi icon={Users} label="Leads em aberto" value={k.openLeads} hint="no funil agora" tone="sky" />
            <Kpi icon={Wallet} label="Valor no funil" value={formatCompactCurrency(k.pipelineValue)} hint={formatCurrency(k.pipelineValue)} tone="purple" />
            <Kpi icon={UserPlus} label="Novos leads" value={k.newLeads} hint={`nos últimos ${data.days} dias`} tone="primary" />
            <Kpi icon={Trophy} label="Ganhos" value={k.wonCount} hint={formatCurrency(k.wonValue)} tone="green" />
            <Kpi
              icon={Percent}
              label="Conversão"
              value={k.conversionRate === null ? '—' : `${k.conversionRate.toLocaleString('pt-BR')}%`}
              hint={`${k.wonCount} ganho(s) · ${k.lostCount} perdido(s)`}
              tone="amber"
            />
            <Kpi
              icon={AlarmClock}
              label="Tarefas"
              value={k.overdueTasks}
              hint={<><Link to="/tarefas" className="underline">atrasada(s)</Link> · {k.todayTasks} para hoje</>}
              tone={k.overdueTasks > 0 ? 'red' : 'green'}
            />
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mb-4">
            <Card>
              <h2 className="text-base font-semibold text-fg mb-4">Funil por etapa</h2>
              <div className="text-fg-muted" style={{ height: Math.max(220, data.funnel.length * 40) }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.funnel} layout="vertical" margin={{ left: 8, right: 16 }}>
                    <CartesianGrid horizontal={false} stroke="currentColor" strokeOpacity={0.15} />
                    <XAxis type="number" allowDecimals={false} tick={{ fill: 'currentColor', fontSize: 12 }} stroke="currentColor" strokeOpacity={0.3} />
                    <YAxis type="category" dataKey="name" width={110} tick={{ fill: 'currentColor', fontSize: 12 }} stroke="currentColor" strokeOpacity={0.3} />
                    <Tooltip
                      contentStyle={tooltipStyle}
                      cursor={{ fill: 'currentColor', fillOpacity: 0.08 }}
                      formatter={(value, _name, item) => [`${value} lead(s) · ${formatCurrency(Number(item.payload.value))}`, 'Etapa']}
                    />
                    <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                      {data.funnel.map((f) => <Cell key={f.id} fill={f.color} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <Card>
              <h2 className="text-base font-semibold text-fg mb-4">Novos leads por dia</h2>
              <div className="text-fg-muted h-[260px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={data.leadsPerDay} margin={{ left: -16, right: 8 }}>
                    <CartesianGrid vertical={false} stroke="currentColor" strokeOpacity={0.15} />
                    <XAxis dataKey="date" tickFormatter={shortDate} minTickGap={24} tick={{ fill: 'currentColor', fontSize: 12 }} stroke="currentColor" strokeOpacity={0.3} />
                    <YAxis allowDecimals={false} tick={{ fill: 'currentColor', fontSize: 12 }} stroke="currentColor" strokeOpacity={0.3} />
                    <Tooltip contentStyle={tooltipStyle} labelFormatter={(l) => shortDate(String(l))} formatter={(value) => [value, 'Leads']} />
                    <Area type="monotone" dataKey="count" stroke="#B80000" fill="#B80000" fillOpacity={0.15} strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <Card>
              <h2 className="text-base font-semibold text-fg mb-4">Origem dos novos leads</h2>
              {data.bySource.length === 0 ? (
                <p className="text-sm text-fg-muted py-8 text-center">Sem leads novos no período.</p>
              ) : (
                <ul className="flex flex-col gap-3">
                  {data.bySource.map((s) => {
                    const max = data.bySource[0].count
                    return (
                      <li key={s.source}>
                        <div className="flex justify-between text-sm mb-1">
                          <span className="text-fg">{s.source}</span>
                          <span className="text-fg-muted">{s.count}</span>
                        </div>
                        <div className="h-2 rounded-full bg-surface-hover overflow-hidden">
                          <div className="h-full rounded-full bg-orange-500" style={{ width: `${(s.count / max) * 100}%` }} />
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </Card>

            <Card padding={false}>
              <h2 className="text-base font-semibold text-fg p-6 pb-4">Desempenho por vendedor</h2>
              {data.bySeller.length === 0 ? (
                <p className="text-sm text-fg-muted pb-8 text-center">Sem dados no período.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs uppercase tracking-wider text-fg-muted border-y border-border">
                        <th className="px-6 py-2 font-semibold">Vendedor</th>
                        <th className="px-3 py-2 font-semibold">Ganhos</th>
                        <th className="px-3 py-2 font-semibold">Valor ganho</th>
                        <th className="px-6 py-2 font-semibold">Em aberto</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {data.bySeller.map((s) => (
                        <tr key={s.id}>
                          <td className="px-6 py-2.5 text-fg font-medium">{s.name}</td>
                          <td className="px-3 py-2.5 text-fg">{s.wonCount}</td>
                          <td className="px-3 py-2.5 text-fg whitespace-nowrap">{formatCurrency(s.wonValue)}</td>
                          <td className="px-6 py-2.5 text-fg-muted whitespace-nowrap">{s.openCount} · {formatCompactCurrency(s.openValue)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </div>
        </div>
      ) : null}
    </>
  )
}
