import { useEffect, useRef, useState, type ReactNode } from 'react'
import { SiWhatsapp } from 'react-icons/si'
import { StickyNote, Phone, MoreHorizontal, RefreshCw, MapPin, Trash2, ChevronDown, Check } from 'lucide-react'
import { cn } from '../../../utils/cn'
import type { Lead, StatusContato, Responsavel } from '../../../api/lead.api'
import {
  ClassificationPill, CONTATO_LABEL, CONTATO_COLOR, CONTATO_OPTIONS, useResponsaveis,
  menuClass, menuItemClass, Highlight, leadLinks, SiteExtras, OwnerGroupBadge, whatsappDigits, isMobilePhone, countryFlag, useClickOutside,
} from './shared'

const stop = (e: React.SyntheticEvent) => e.stopPropagation()

interface Handlers {
  updatingId: string | null
  onContato: (lead: Lead, status: StatusContato) => void
  onResponsavel: (lead: Lead, r: Responsavel | null) => void
  onOpen: (lead: Lead, focusNotes?: boolean) => void
  onReverificar: (lead: Lead) => void
  onDelete: (lead: Lead) => void
}

const RESP_AVATAR: Record<string, string> = {
  Max: 'bg-tone-sky-solid text-white',
  Jean: 'bg-tone-purple-solid text-white',
}

function subtitle(l: Lead): string {
  const rating = l.avaliacao != null ? `★ ${l.avaliacao.toFixed(1)} (${l.numAvaliacoes ?? 0})` : ''
  const place = [l.city, l.state].filter(Boolean).join(' - ')
  return [rating, place].filter(Boolean).join(' · ')
}

const LINK_COLOR: Record<string, string> = {
  instagram: 'text-tone-purple-solid dark:text-tone-purple-fg',
  linktree: 'text-tone-sky-solid dark:text-tone-sky-fg',
  booking: 'text-tone-blue-solid dark:text-tone-blue-fg',
}

const chipBase = 'shrink-0 inline-flex items-center gap-2 h-8 rounded-lg border px-2.5 text-sm tabular-nums whitespace-nowrap transition-colors'
const chipWa = 'bg-[#DCFCE7] text-[#15803D] border-[#BBF7D0] hover:bg-[#BBF7D0] dark:bg-[#22C55E]/15 dark:text-[#4ADE80] dark:border-[#22C55E]/25 dark:hover:bg-[#22C55E]/25'
const chipPhone = 'bg-surface-hover text-fg-muted border-border'

function ContactCell({ lead }: { lead: Lead }) {
  const others = leadLinks(lead).filter((l) => l.key !== 'whatsapp')
  const digits = whatsappDigits(lead)
  const flag = countryFlag(lead.phoneCountry)
  return (
    <div className="flex items-center gap-2 whitespace-nowrap min-w-0">
      {!lead.whatsapp || !digits ? (
        <span className="text-sm italic text-fg-muted/70">Sem telefone</span>
      ) : isMobilePhone(lead) ? (
        <a href={`https://wa.me/${digits}`} target="_blank" rel="noreferrer" onClick={stop} title="Chamar no WhatsApp" aria-label={`Chamar ${lead.arenaName} no WhatsApp`} className={cn(chipBase, chipWa)}>
          <SiWhatsapp size={14} /> {flag && <span title={lead.phoneCountry ?? undefined}>{flag}</span>}{lead.whatsapp}
        </a>
      ) : (
        <span title="Telefone fixo" className={cn(chipBase, chipPhone)}>
          <Phone size={14} /> {flag && <span title={lead.phoneCountry ?? undefined}>{flag}</span>}{lead.whatsapp}
        </span>
      )}
      {others.map(({ key, label, href, Icon }) => (
        <a key={key} href={href} target="_blank" rel="noreferrer" onClick={stop} title={label} aria-label={`${label} de ${lead.arenaName}`}
          className={cn('shrink-0 opacity-60 group-hover:opacity-100 hover:!opacity-100 transition-opacity', LINK_COLOR[key] ?? 'text-fg-muted')}>
          <Icon size={15} />
        </a>
      ))}
    </div>
  )
}

// Dropdown customizado (posição fixa: a tabela tem overflow e cortaria um menu absoluto).
function PopSelect({ trigger, triggerClass, ariaLabel, disabled, options, value, onSelect }: {
  trigger: ReactNode
  triggerClass: string
  ariaLabel: string
  disabled?: boolean
  options: { value: string; node: ReactNode }[]
  value: string
  onSelect: (v: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number }>({ left: 0 })
  const ref = useRef<HTMLDivElement>(null)
  const btn = useRef<HTMLButtonElement>(null)
  useClickOutside(ref, () => setOpen(false), open)

  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    document.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  function toggle() {
    if (!open && btn.current) {
      const r = btn.current.getBoundingClientRect()
      const below = window.innerHeight - r.bottom
      const need = options.length * 36 + 12
      setPos(below < need && r.top > below
        ? { left: r.left, bottom: window.innerHeight - r.top + 6 }
        : { left: r.left, top: r.bottom + 6 })
    }
    setOpen((o) => !o)
  }

  return (
    <div ref={ref} onClick={stop} className="max-w-full shrink-0">
      <button ref={btn} type="button" disabled={disabled} onClick={toggle} aria-haspopup="menu" aria-expanded={open} aria-label={ariaLabel} className={triggerClass}>
        {trigger}
      </button>
      {open && (
        <div role="menu" style={{ position: 'fixed', ...pos }} className="z-50 min-w-[10.5rem] rounded-xl border border-border bg-surface shadow-xl py-1">
          {options.map((o) => (
            <button key={o.value} role="menuitemradio" aria-checked={o.value === value} onClick={() => { setOpen(false); if (o.value !== value) onSelect(o.value) }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-fg hover:bg-surface-hover">
              <span className="flex-1 text-left">{o.node}</span>
              {o.value === value && <Check size={14} className="text-fg-muted" />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function ResponsavelCell({ lead, h }: { lead: Lead; h: Handlers }) {
  const r = lead.responsavel
  const rNome = lead.responsavelNome ?? r ?? ''
  const responsaveis = useResponsaveis()
  const avatar = (name: string) => (
    <span aria-hidden className={cn('w-6 h-6 shrink-0 rounded-full flex items-center justify-center text-[11px] font-semibold', RESP_AVATAR[name] ?? 'bg-tone-slate-solid text-white')}>{name[0]}</span>
  )
  return (
    <PopSelect
      ariaLabel={`Responsável por ${lead.arenaName}`}
      disabled={h.updatingId === lead.id}
      triggerClass="flex w-fit max-w-full items-center gap-2 rounded-lg -mx-1.5 px-1.5 py-1 hover:bg-surface-hover text-sm text-fg"
      trigger={r
        ? <>{avatar(rNome)}<span className="whitespace-nowrap">{rNome}</span></>
        : <><span aria-hidden className="w-6 h-6 shrink-0 rounded-full border border-dashed border-border" /><span className="text-fg-muted/70 italic">Ninguém</span></>}
      value={r ?? ''}
      onSelect={(v) => h.onResponsavel(lead, (v || null) as Responsavel | null)}
      options={[
        { value: '', node: <span className="text-fg-muted">Ninguém</span> },
        ...responsaveis.map((u) => ({ value: u.id, node: <span className="flex items-center gap-2">{avatar(u.name)}{u.name}</span> })),
      ]}
    />
  )
}

function ContatoSelect({ lead, h }: { lead: Lead; h: Handlers }) {
  return (
    <PopSelect
      ariaLabel={`Status de contato de ${lead.arenaName}`}
      disabled={h.updatingId === lead.id}
      triggerClass={cn('inline-flex items-center gap-1 rounded-full pl-2.5 pr-1.5 py-1 text-xs font-medium whitespace-nowrap disabled:opacity-60', CONTATO_COLOR[lead.status])}
      trigger={<>{CONTATO_LABEL[lead.status]}<ChevronDown size={12} className="opacity-70" /></>}
      value={lead.status}
      onSelect={(v) => h.onContato(lead, v as StatusContato)}
      options={CONTATO_OPTIONS.map((s) => ({
        value: s,
        node: <span className={cn('inline-block rounded-full px-2.5 py-0.5 text-xs font-medium', CONTATO_COLOR[s])}>{CONTATO_LABEL[s]}</span>,
      }))}
    />
  )
}

function RowActions({ lead, h }: { lead: Lead; h: Handlers }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useClickOutside(ref, () => setOpen(false), open)
  const reveal = 'md:opacity-0 md:group-hover:opacity-100 focus-visible:opacity-100 focus:opacity-100'
  return (
    <div className="flex items-center justify-end gap-0.5" onClick={stop}>
      <button type="button" onClick={() => h.onOpen(lead, true)} title={lead.notes ? 'Ver nota' : 'Adicionar nota'} aria-label={`Notas de ${lead.arenaName}`}
        className={cn('relative p-1.5 rounded-lg text-fg-muted hover:bg-surface-hover hover:text-fg transition-opacity', lead.notes ? '' : reveal)}>
        <StickyNote size={16} />
        {lead.notes && <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-orange-500 ring-2 ring-surface" />}
      </button>
      <div ref={ref} className="relative">
        <button type="button" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} aria-label={`Mais ações de ${lead.arenaName}`}
          className={cn('p-1.5 rounded-lg text-fg-muted hover:bg-surface-hover hover:text-fg transition-opacity', open ? '' : reveal)}>
          <MoreHorizontal size={16} />
        </button>
        {open && (
          <div role="menu" className={`${menuClass} right-0`}>
            <button role="menuitem" className={menuItemClass} onClick={() => { setOpen(false); h.onReverificar(lead) }}><RefreshCw size={14} /> Reverificar presença</button>
            {lead.googleMapsUrl && (
              <a role="menuitem" className={menuItemClass} href={lead.googleMapsUrl} target="_blank" rel="noreferrer" onClick={() => setOpen(false)}><MapPin size={14} /> Abrir no Maps</a>
            )}
            <button role="menuitem" className={cn(menuItemClass, 'text-tone-red-fg')} onClick={() => { setOpen(false); h.onDelete(lead) }}><Trash2 size={14} /> Excluir</button>
          </div>
        )}
      </div>
    </div>
  )
}

export function LeadsTable({
  leads, selected, pageAllSelected, onToggle, onTogglePage, query = '', ...h
}: {
  leads: Lead[]
  query?: string
  selected: Set<string>
  pageAllSelected: boolean
  onToggle: (id: string) => void
  onTogglePage: () => void
} & Handlers) {
  const checkbox = 'w-4 h-4 rounded accent-orange-500 shrink-0'
  const th = 'text-left px-4 py-3 text-xs font-medium uppercase tracking-wider text-fg-muted'

  return (
    <>
      <div className="hidden md:block relative overflow-x-auto">
        <table className="w-full table-fixed">
          <colgroup>
            <col style={{ width: '30%' }} />
            <col style={{ width: '20%' }} />
            <col style={{ width: '16%' }} />
            <col style={{ width: '15%' }} />
            <col className="hidden xl:table-column" style={{ width: '13%' }} />
            <col style={{ width: '6%' }} />
          </colgroup>
          <thead>
            <tr className="bg-surface-hover/50 border-b border-divider">
              <th className={cn(th, 'pl-5')}>
                <div className="flex items-center gap-3">
                  <input type="checkbox" checked={pageAllSelected} onChange={onTogglePage} aria-label="Selecionar todos desta página" className={checkbox} />
                  Negócio
                </div>
              </th>
              <th className={th}>Contato</th>
              <th className={th}>Presença digital</th>
              <th className={th}>Status</th>
              <th className={cn(th, 'hidden xl:table-cell')}>Responsável</th>
              <th className={th}><span className="sr-only">Ações</span></th>
            </tr>
          </thead>
          <tbody>
            {leads.map((l) => (
              <tr
                key={l.id}
                onClick={() => h.onOpen(l)}
                className="group h-[60px] border-b border-divider last:border-0 hover:bg-surface-hover cursor-pointer transition-colors"
              >
                <td className="pl-5 pr-4" >
                  <div className="flex items-center gap-3 min-w-0">
                    <span onClick={stop} className="flex">
                      <input type="checkbox" checked={selected.has(l.id)} onChange={() => onToggle(l.id)} aria-label={`Selecionar ${l.arenaName}`} className={checkbox} />
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-fg truncate" title={l.arenaName}><Highlight text={l.arenaName} query={query} /></p>
                      <p className="text-xs text-fg-muted truncate tabular-nums">{subtitle(l)}</p>
                      <OwnerGroupBadge lead={l} className="mt-0.5" />
                    </div>
                  </div>
                </td>
                <td className="px-4" onClick={stop}><ContactCell lead={l} /></td>
                <td className="px-4">
                  <div className="flex items-center gap-1 whitespace-nowrap">
                    <ClassificationPill lead={l} />
                    <button type="button" onClick={(e) => { stop(e); h.onReverificar(l) }} aria-label={`Reverificar ${l.arenaName}`}
                      title={l.verificadoEm ? `Verificado em ${new Date(l.verificadoEm).toLocaleDateString('pt-BR')}. Reverificar` : 'Ainda não verificado. Reverificar'}
                      className="p-1 rounded text-fg-muted hover:text-fg opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity">
                      <RefreshCw size={13} />
                    </button>
                  </div>
                  <SiteExtras lead={l} className="mt-0.5" />
                </td>
                <td className="px-4"><ContatoSelect lead={l} h={h} /></td>
                <td className="px-4 hidden xl:table-cell"><ResponsavelCell lead={l} h={h} /></td>
                <td className="px-3"><RowActions lead={l} h={h} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="md:hidden divide-y divide-divider">
        {leads.map((l) => (
          <li key={l.id} className="group p-4 flex flex-col gap-3" onClick={() => h.onOpen(l)}>
            <div className="flex items-start gap-3">
              <span onClick={stop}><input type="checkbox" checked={selected.has(l.id)} onChange={() => onToggle(l.id)} aria-label={`Selecionar ${l.arenaName}`} className={cn(checkbox, 'mt-1')} /></span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-fg truncate" title={l.arenaName}><Highlight text={l.arenaName} query={query} /></p>
                <p className="text-xs text-fg-muted truncate tabular-nums">{subtitle(l)}</p>
                <OwnerGroupBadge lead={l} className="mt-0.5" />
              </div>
              <div className="flex flex-col items-end gap-1 shrink-0 max-w-[45%] min-w-0 [&_*]:max-w-full"><ClassificationPill lead={l} /><SiteExtras lead={l} className="items-end" /></div>
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2" onClick={stop}>
              <ContactCell lead={l} />
              <span className="ml-auto"><ContatoSelect lead={l} h={h} /></span>
            </div>
            <div className="flex items-center justify-between" onClick={stop}>
              <ResponsavelCell lead={l} h={h} />
              <RowActions lead={l} h={h} />
            </div>
          </li>
        ))}
      </ul>
    </>
  )
}
