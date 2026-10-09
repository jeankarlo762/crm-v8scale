import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Megaphone, Users, Briefcase, Target, Kanban, type LucideIcon } from 'lucide-react'
import { PageHeader } from '../../components/layout/AppLayout'
import { Card } from '../../components/ui/Card'
import { Input } from '../../components/ui/Input'
import { Select } from '../../components/ui/Select'
import * as usersApi from '../../api/users.api'
import { cn } from '../../utils/cn'
import CampanhasReport from './CampanhasReport'
import UsuariosReport from './UsuariosReport'
import ComercialReport from './ComercialReport'
import ProspeccaoReport from './ProspeccaoReport'
import FunilReport from './FunilReport'

const TABS: { key: string; label: string; icon: LucideIcon }[] = [
  { key: 'campanhas', label: 'Campanhas', icon: Megaphone },
  { key: 'usuarios', label: 'Usuários', icon: Users },
  { key: 'comercial', label: 'Comercial', icon: Briefcase },
  { key: 'prospeccao', label: 'Prospecção', icon: Target },
  { key: 'funil', label: 'Funil', icon: Kanban },
]

const TZ = 'America/Sao_Paulo'
const day = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: TZ })
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000)

/** Atalhos de período calculados sobre "hoje" em Brasília; '' = sem limite. */
function presetRange(key: string): { from: string; to: string } {
  const now = new Date()
  const [y, m] = day(now).split('-').map(Number)
  const ymd = (yy: number, mm: number, dd: number) => day(new Date(Date.UTC(yy, mm - 1, dd, 12)))
  const last = (yy: number, mm: number) => new Date(Date.UTC(yy, mm, 0)).getUTCDate()
  switch (key) {
    case '7': return { from: day(addDays(now, -6)), to: day(now) }
    case '30': return { from: day(addDays(now, -29)), to: day(now) }
    case '90': return { from: day(addDays(now, -89)), to: day(now) }
    case 'month': return { from: ymd(y, m, 1), to: ymd(y, m, last(y, m)) }
    case 'lastmonth': { const pm = m === 1 ? 12 : m - 1; const py = m === 1 ? y - 1 : y; return { from: ymd(py, pm, 1), to: ymd(py, pm, last(py, pm)) } }
    case 'year': return { from: ymd(y, 1, 1), to: ymd(y, 12, 31) }
    default: return { from: '', to: '' }
  }
}

const PRESETS = [
  { value: '7', label: 'Últimos 7 dias' },
  { value: '30', label: 'Últimos 30 dias' },
  { value: '90', label: 'Últimos 90 dias' },
  { value: 'month', label: 'Este mês' },
  { value: 'lastmonth', label: 'Mês passado' },
  { value: 'year', label: 'Este ano' },
  { value: 'all', label: 'Todo o período' },
  { value: 'custom', label: 'Personalizado' },
]

export default function RelatoriosPage() {
  const [params, setParams] = useSearchParams()
  const tab = TABS.some((t) => t.key === params.get('aba')) ? (params.get('aba') as string) : 'campanhas'
  const [preset, setPreset] = useState('30')
  const [custom, setCustom] = useState(presetRange('30'))
  const [users, setUsers] = useState<{ id: string; name: string }[]>([])

  useEffect(() => {
    usersApi.listUsers().then((list) => setUsers(list.map((u) => ({ id: u.id, name: u.active ? u.name : `${u.name} (inativo)` })))).catch(() => undefined)
  }, [])

  const range = useMemo(() => (preset === 'custom' ? custom : presetRange(preset)), [preset, custom])
  // Período personalizado incompleto ou invertido não dispara consulta.
  const valid = !(range.from && range.to && range.from > range.to)
  const from = valid ? range.from || undefined : undefined
  const to = valid ? range.to || undefined : undefined
  const common = { from, to }

  return (
    <div>
      <PageHeader title="Relatórios" subtitle="Campanhas, usuários, comercial, prospecção e funil — calculados na hora com os dados do CRM" />

      <Card className="mb-6" padding={false}>
        <div className="p-4 flex flex-wrap items-end gap-3">
          <div className="w-52"><Select label="Período" value={preset} onChange={(e) => setPreset(e.target.value)} options={PRESETS} /></div>
          {preset === 'custom' && (
            <>
              <div className="w-40"><Input label="De" type="date" value={custom.from} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} /></div>
              <div className="w-40"><Input label="Até" type="date" value={custom.to} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} error={valid ? undefined : 'Fim antes do início'} /></div>
            </>
          )}
          {preset !== 'all' && from && to && <p className="text-xs text-fg-muted pb-2">{from.split('-').reverse().join('/')} a {to.split('-').reverse().join('/')}</p>}
        </div>
      </Card>

      <div role="tablist" className="flex gap-1 overflow-x-auto border-b border-border mb-6">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => setParams({ aba: key }, { replace: true })}
            className={cn(
              'flex items-center gap-2 px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 -mb-px transition-colors',
              tab === key ? 'border-orange-500 text-orange-600 dark:text-orange-400' : 'border-transparent text-fg-muted hover:text-fg',
            )}
          >
            <Icon size={16} />{label}
          </button>
        ))}
      </div>

      {tab === 'campanhas' && <CampanhasReport {...common} users={users} />}
      {tab === 'usuarios' && <UsuariosReport {...common} />}
      {tab === 'comercial' && <ComercialReport {...common} users={users} />}
      {tab === 'prospeccao' && <ProspeccaoReport {...common} />}
      {tab === 'funil' && <FunilReport {...common} users={users} />}
    </div>
  )
}
