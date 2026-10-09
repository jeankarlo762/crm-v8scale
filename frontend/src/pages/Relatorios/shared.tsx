import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import toast from 'react-hot-toast'
import { Download, type LucideIcon } from 'lucide-react'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Spinner } from '../../components/ui/Spinner'
import { errMsg } from '../../utils/apiError'

export const tooltipStyle = {
  background: 'rgb(var(--surface))',
  border: '1px solid rgb(var(--border))',
  borderRadius: 8,
  color: 'rgb(var(--fg))',
  fontSize: 12,
}
export const axisProps = { tick: { fill: 'currentColor', fontSize: 12 }, stroke: 'currentColor', strokeOpacity: 0.3 } as const
export const nf = new Intl.NumberFormat('pt-BR')
export const fmtPct = (n: number) => `${n.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`
export const shortDay = (iso: string) => { const [, m, d] = iso.split('-'); return `${d}/${m}` }
export const fmtDate = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '—')
export const fmtDateTime = (iso: string | null | undefined) =>
  (iso ? new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—')

const TONES = {
  primary: 'bg-primary-soft text-primary-soft-fg',
  green: 'bg-tone-green-bg text-tone-green-fg',
  sky: 'bg-tone-sky-bg text-tone-sky-fg',
  amber: 'bg-tone-amber-bg text-tone-amber-fg',
  purple: 'bg-tone-purple-bg text-tone-purple-fg',
  red: 'bg-tone-red-bg text-tone-red-fg',
}
export type Tone = keyof typeof TONES

export function Kpi({ icon: Icon, label, value, hint, tone = 'primary' }: { icon: LucideIcon; label: string; value: ReactNode; hint?: ReactNode; tone?: Tone }) {
  return (
    <Card className="flex items-start gap-3" padding={false}>
      <div className="flex items-start gap-3 p-4 min-w-0">
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${TONES[tone]}`}><Icon size={18} /></div>
        <div className="min-w-0">
          <p className="text-xs text-fg-muted">{label}</p>
          <p className="text-xl font-bold text-fg mt-0.5 truncate">{value}</p>
          {hint && <p className="text-xs text-fg-muted mt-0.5">{hint}</p>}
        </div>
      </div>
    </Card>
  )
}

export function KpiGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">{children}</div>
}

export function Section({ title, hint, action, children }: { title: string; hint?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <Card className="mb-6">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h2 className="text-base font-semibold text-fg">{title}</h2>
          {hint && <p className="text-xs text-fg-muted mt-0.5">{hint}</p>}
        </div>
        {action}
      </div>
      {children}
    </Card>
  )
}

/** Dá a altura do gráfico e a cor de texto herdada (eixos/grade usam currentColor, então seguem o tema). */
export function ChartBox({ height = 240, children }: { height?: number; children: ReactNode }) {
  return <div className="text-fg-muted" style={{ height }}>{children}</div>
}

/** Tabela simples de relatório (rolagem horizontal, rodapé de total opcional). */
export interface Col<T> { key: string; header: string; cell: (r: T) => ReactNode; align?: 'right'; total?: ReactNode }
export function ReportTable<T>({ cols, rows, rowKey, empty = 'Sem dados no período', onRowClick }: { cols: Col<T>[]; rows: T[]; rowKey: (r: T) => string; empty?: string; onRowClick?: (r: T) => void }) {
  const hasTotal = cols.some((c) => c.total !== undefined)
  const th = 'px-3 py-2 text-xs font-semibold text-fg-muted uppercase tracking-wide whitespace-nowrap'
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="min-w-full text-sm">
        <thead className="bg-surface-hover">
          <tr>{cols.map((c) => <th key={c.key} className={`${th} ${c.align === 'right' ? 'text-right' : 'text-left'}`}>{c.header}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.length === 0 ? (
            <tr><td colSpan={cols.length} className="px-3 py-8 text-center text-fg-muted">{empty}</td></tr>
          ) : rows.map((r) => (
            <tr key={rowKey(r)} onClick={onRowClick ? () => onRowClick(r) : undefined} className={onRowClick ? 'cursor-pointer hover:bg-surface-hover' : undefined}>
              {cols.map((c) => <td key={c.key} className={`px-3 py-2 text-fg whitespace-nowrap ${c.align === 'right' ? 'text-right tabular-nums' : ''}`}>{c.cell(r)}</td>)}
            </tr>
          ))}
        </tbody>
        {hasTotal && rows.length > 0 && (
          <tfoot className="bg-surface-hover font-semibold">
            <tr>{cols.map((c, i) => <td key={c.key} className={`px-3 py-2 text-fg ${c.align === 'right' ? 'text-right tabular-nums' : ''}`}>{c.total ?? (i === 0 ? 'Total' : '')}</td>)}</tr>
          </tfoot>
        )}
      </table>
    </div>
  )
}

/** Carrega um relatório a cada mudança de filtro; ignora respostas de requisições antigas. */
export function useReport<T>(load: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const seq = useRef(0)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(load, deps)
  useEffect(() => {
    const id = ++seq.current
    setLoading(true)
    run()
      .then((d) => { if (id === seq.current) setData(d) })
      .catch((e) => { if (id === seq.current) toast.error(errMsg(e) ?? 'Não foi possível carregar o relatório') })
      .finally(() => { if (id === seq.current) setLoading(false) })
  }, [run])
  return { data, loading }
}

export function ReportState({ loading, hasData, children }: { loading: boolean; hasData: boolean; children: ReactNode }) {
  if (!hasData) return loading ? <div className="flex justify-center py-16"><Spinner size="lg" className="text-orange-500" /></div> : null
  return <div className={loading ? 'opacity-60 transition-opacity' : 'transition-opacity'}>{children}</div>
}

/** Baixa as linhas como CSV (separador ";" e BOM, para abrir direto no Excel em pt-BR). */
export function downloadCsv(filename: string, header: string[], rows: (string | number | null | undefined)[][]) {
  const esc = (v: string | number | null | undefined) => {
    const s = v == null ? '' : String(v)
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const text = [header, ...rows].map((r) => r.map(esc).join(';')).join('\r\n')
  const url = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function CsvButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return <Button variant="secondary" size="sm" onClick={onClick} disabled={disabled}><Download size={14} className="mr-1.5" />Exportar CSV</Button>
}
