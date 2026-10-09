import { useRef, useState } from 'react'
import { SlidersHorizontal, X } from 'lucide-react'
import { cn } from '../../../utils/cn'
import type { StatusSite, StatusContato, Responsavel, DecisionFilter, ProgressFilter } from '../../../api/lead.api'
import {
  SITE_LABEL, SITE_DOT, SITE_TINT, SITE_OPTIONS, SITE_FILTER_DEFAULT, CONTATO_LABEL, CONTATO_OPTIONS, ResponsavelOptionTags,
  NOTA_OPTIONS, PAGE_SIZES, EMPTY_FILTERS, selectClass, useClickOutside, type Filters,
  DECISION_LABEL, DECISION_DOT, DECISION_OPTIONS, PROGRESS_LABEL, PROGRESS_OPTIONS,
} from './shared'

// Chips de filtro com contador. Nenhum marcado = todos.
function ChipGroup<T extends string>({ label, options, selected, counts, text, dot, onChange }: {
  label: string; options: T[]; selected: T[]; counts: Record<T, number>; text: Record<T, string>; dot?: Record<T, string>; onChange: (next: T[]) => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={label}>
      <span className="text-xs font-medium text-fg-muted mr-1">{label}</span>
      {options.map((o) => {
        const on = selected.includes(o)
        return (
          <button key={o} type="button" aria-pressed={on} onClick={() => onChange(on ? selected.filter((x) => x !== o) : [...selected, o])}
            className={cn('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-400',
              on ? 'border-orange-500 bg-orange-500/10 text-fg' : 'border-border text-fg-muted hover:bg-surface-hover', counts[o] === 0 && !on && 'opacity-50')}>
            {dot && <span className={cn('w-1.5 h-1.5 rounded-full', dot[o])} />}{text[o]}<span className="tabular-nums font-semibold text-fg">{counts[o]}</span>
          </button>
        )
      })}
      {selected.length > 0 && <button type="button" onClick={() => onChange([])} className="text-xs text-orange-600 dark:text-orange-400 hover:underline ml-1">limpar</button>}
    </div>
  )
}

const ghostBtn = 'inline-flex items-center gap-1.5 whitespace-nowrap text-sm font-medium rounded-lg border px-3 h-9 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-400'
const ghostOff = 'border-border text-fg-muted hover:bg-surface-hover hover:text-fg'

function activeFilterChips(f: Filters): { key: keyof Filters; label: string }[] {
  const out: { key: keyof Filters; label: string }[] = []
  if (f.estado) out.push({ key: 'estado', label: f.estado })
  if (f.cidade) out.push({ key: 'cidade', label: f.cidade })
  if (f.contato) out.push({ key: 'contato', label: CONTATO_LABEL[f.contato] })
  if (f.responsavel) out.push({ key: 'responsavel', label: f.responsavel === 'nenhum' ? 'Sem responsável' : f.responsavel })
  if (f.notaMin) out.push({ key: 'notaMin', label: `Nota ${Number(f.notaMin).toFixed(1)}+` })
  if (f.avalMin) out.push({ key: 'avalMin', label: `Mín. ${f.avalMin} aval.` })
  if (f.avalMax) out.push({ key: 'avalMax', label: `Máx. ${f.avalMax} aval.` })
  if (f.soCelular) out.push({ key: 'soCelular', label: 'Só celular' })
  return out
}

export function LeadsFilterBar({
  siteFilter, onSiteFilter, decisionFilter, onDecisionFilter, progressFilter, onProgressFilter, decisionCounts, progressCounts, counts, total, filters, onFilters, estados, cidades, shown, pageSize, onPageSize,
}: {
  siteFilter: StatusSite[]
  onSiteFilter: (next: StatusSite[]) => void
  decisionFilter: DecisionFilter[]
  onDecisionFilter: (next: DecisionFilter[]) => void
  progressFilter: ProgressFilter[]
  onProgressFilter: (next: ProgressFilter[]) => void
  decisionCounts: Record<DecisionFilter, number>
  progressCounts: Record<ProgressFilter, number>
  counts: Record<StatusSite, number>
  total: number
  filters: Filters
  onFilters: (next: Filters) => void
  estados: string[]
  cidades: string[]
  shown: number
  pageSize: number
  onPageSize: (n: number) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useClickOutside(ref, () => setOpen(false), open)

  const allOn = siteFilter.length === SITE_OPTIONS.length
  const active = activeFilterChips(filters)
  const set = <K extends keyof Filters>(key: K, value: Filters[K]) => onFilters({ ...filters, [key]: value })
  const allCount = SITE_OPTIONS.reduce((n, s) => n + counts[s], 0)

  const cards: { key: 'all' | StatusSite; label: string; n: number; on: boolean; dot: string; onClick: () => void }[] = [
    { key: 'all', label: 'Todas', n: allCount, on: allOn, dot: 'bg-fg-muted', onClick: () => onSiteFilter(allOn ? SITE_FILTER_DEFAULT : SITE_OPTIONS) },
    ...SITE_OPTIONS
      .filter((s) => s !== 'verificar' || counts[s] > 0 || siteFilter.includes(s))
      .map((s) => {
        const on = siteFilter.includes(s)
        return { key: s, label: SITE_LABEL[s], n: counts[s], on, dot: SITE_DOT[s], onClick: () => onSiteFilter(on ? siteFilter.filter((x) => x !== s) : [...siteFilter, s]) }
      }),
  ]

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[11px] text-fg-muted -mb-2">Evidência por fonte (Google Maps, redes, site): não é a decisão final. A decisão final está em "Decisão do site".</p>
      <div className="grid gap-3 grid-cols-[repeat(auto-fit,minmax(9.5rem,1fr))]" role="group" aria-label="Filtrar por evidência de presença digital (não é a decisão final)">
        {cards.map((c) => (
          <button
            key={c.key}
            type="button"
            aria-pressed={c.on}
            onClick={c.onClick}
            className={cn(
              'flex flex-col items-start gap-1 rounded-xl border px-4 py-3 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-400',
              c.on && c.n > 0 ? cn('border-orange-500', SITE_TINT[c.key]) : c.on ? cn('border-border', SITE_TINT[c.key]) : 'border-border bg-surface hover:bg-surface-hover',
              c.n === 0 && 'opacity-50',
            )}
          >
            <span className="text-2xl font-semibold text-fg tabular-nums leading-none">{c.n}</span>
            <span className="inline-flex items-center gap-1.5 text-xs text-fg-muted whitespace-nowrap">
              <span className={cn('w-2 h-2 rounded-full', c.dot)} />{c.label}
            </span>
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface px-4 py-3">
        <ChipGroup label="Decisão do site" options={DECISION_OPTIONS} selected={decisionFilter} counts={decisionCounts} text={DECISION_LABEL} dot={DECISION_DOT} onChange={onDecisionFilter} />
        <ChipGroup label="Andamento" options={PROGRESS_OPTIONS} selected={progressFilter} counts={progressCounts} text={PROGRESS_LABEL} onChange={onProgressFilter} />
        <p className="text-[11px] text-fg-muted">Aguardando cota/nova tentativa não é "sem site": a investigação retoma sozinha. Confiança é heurística, não calibrada.</p>
      </div>

      <div className="flex flex-wrap items-center gap-2 -mb-2">
        <div ref={ref} className="relative shrink-0">
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            className={cn(ghostBtn, active.length ? 'border-orange-500 text-orange-700 dark:text-orange-300' : ghostOff)}
          >
            <SlidersHorizontal size={14} /> Filtros{active.length ? ` · ${active.length}` : ''}
          </button>
          {open && (
            <div className="absolute left-0 z-30 mt-1.5 w-72 rounded-xl border border-border bg-surface shadow-lg p-4 flex flex-col gap-3">
              <label className="flex flex-col gap-1 text-xs font-medium text-fg-muted">Estado
                <select value={filters.estado} onChange={(e) => set('estado', e.target.value)} className={selectClass}>
                  <option value="">Todos os estados</option>
                  {estados.map((uf) => <option key={uf} value={uf}>{uf}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium text-fg-muted">Cidade
                <select value={filters.cidade} onChange={(e) => set('cidade', e.target.value)} className={selectClass}>
                  <option value="">Todas as cidades</option>
                  {cidades.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium text-fg-muted">Status de contato
                <select value={filters.contato} onChange={(e) => set('contato', e.target.value as StatusContato | '')} className={selectClass}>
                  <option value="">Todos</option>
                  {CONTATO_OPTIONS.map((s) => <option key={s} value={s}>{CONTATO_LABEL[s]}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium text-fg-muted">Responsável
                <select value={filters.responsavel} onChange={(e) => set('responsavel', e.target.value as Responsavel | 'nenhum' | '')} className={selectClass}>
                  <option value="">Todos</option>
                  <ResponsavelOptionTags />
                  <option value="nenhum">Sem responsável</option>
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium text-fg-muted">Nota mínima
                <select value={filters.notaMin} onChange={(e) => set('notaMin', e.target.value)} className={selectClass}>
                  <option value="">Qualquer nota</option>
                  {NOTA_OPTIONS.map((n) => <option key={n} value={n}>{n.toFixed(1)}+</option>)}
                </select>
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="flex flex-col gap-1 text-xs font-medium text-fg-muted">Aval. mín.
                  <input type="number" min={0} value={filters.avalMin} onChange={(e) => set('avalMin', e.target.value)} className={selectClass} />
                </label>
                <label className="flex flex-col gap-1 text-xs font-medium text-fg-muted">Aval. máx.
                  <input type="number" min={0} value={filters.avalMax} onChange={(e) => set('avalMax', e.target.value)} className={selectClass} />
                </label>
              </div>
              <label className="flex items-center gap-2 text-sm text-fg">
                <input type="checkbox" checked={filters.soCelular} onChange={(e) => set('soCelular', e.target.checked)} />
                Só celular
              </label>
              {active.length > 0 && (
                <button type="button" onClick={() => onFilters(EMPTY_FILTERS)} className="text-xs font-medium text-orange-600 dark:text-orange-400 hover:underline self-start">
                  Limpar filtros
                </button>
              )}
            </div>
          )}
        </div>

        {active.map((c) => (
          <span key={c.key} className="inline-flex items-center gap-1 rounded-full bg-tone-orange-solid/15 text-tone-orange-fg text-xs font-medium pl-2.5 pr-1 py-1">
            {c.label}
            <button type="button" onClick={() => set(c.key, (c.key === 'soCelular' ? false : '') as never)} aria-label={`Remover filtro ${c.label}`} className="rounded-full p-0.5 hover:bg-tone-orange-solid/25">
              <X size={12} />
            </button>
          </span>
        ))}

        <div className="ml-auto flex items-center gap-3">
          <span className="text-xs text-fg-muted tabular-nums">{shown} de {total} leads</span>
          <select value={pageSize} onChange={(e) => onPageSize(Number(e.target.value))} className={cn(selectClass, 'py-1.5 text-xs h-9')} aria-label="Leads por página">
            {PAGE_SIZES.map((n) => <option key={n} value={n}>{n} / pág.</option>)}
          </select>
        </div>
      </div>
    </div>
  )
}
