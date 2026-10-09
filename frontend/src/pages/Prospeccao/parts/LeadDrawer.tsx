import { useEffect, useRef, useState } from 'react'
import { X, MapPin, Globe, ExternalLink } from 'lucide-react'
import { Button } from '../../../components/ui/Button'
import type { Lead, StatusContato } from '../../../api/lead.api'
import { sourceEvidence } from './classification'
import { ClassificationPill, SitePill, SiteExtras, OwnerGroupBadge, ProgressBadge, PROGRESS_LABEL, progressOf, reasonLabel, actionLabel, CONTATO_LABEL, CONTATO_OPTIONS, leadLinks, selectClass, instagramStats } from './shared'

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('pt-BR') : 'Ainda não')
const fmtTime = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—')

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold text-fg">{title}</h3>
      {children}
    </section>
  )
}

// Decisão, motivo, evidências, data e próxima ação. Aguardando cota/retry é explicado como espera, não como "sem site".
function ClassificationSection({ lead }: { lead: Lead }) {
  const cov = lead.websiteCoverage
  const conf = lead.websiteConfirmation
  const evid = (lead.websiteEvidence ?? []).filter((e) => e.type !== 'REASON' && e.type !== 'SOURCE_STATE').slice(0, 10)
  const st = progressOf(lead)
  const waiting = st === 'WAITING_QUOTA' || st === 'WAITING_RETRY'
  return (
    <Section title="Classificação do site">
      <div className="flex flex-wrap items-center gap-2">
        <ClassificationPill lead={lead} />
        <ProgressBadge lead={lead} />
        {lead.websiteConfidence != null && lead.websiteStatus && <span className="text-xs text-fg-muted" title="Valor heurístico; ainda não calibrado contra casos rotulados">confiança {Math.round(lead.websiteConfidence * 100)}% (heurística)</span>}
      </div>
      {lead.websiteReason && <p className="text-sm text-fg break-words [overflow-wrap:anywhere]">{reasonLabel(lead.websiteReason)}</p>}
      <p className="text-xs text-fg-muted break-words [overflow-wrap:anywhere]">Decidido em {fmtTime(lead.websiteDecidedAt)}{cov?.calls ? ` · ${cov.calls.tavily} busca(s) Tavily, ${cov.calls.meta} Instagram, ${cov.calls.cacheHits} do cache` : ''}.</p>

      {conf && (
        <p className="text-xs text-fg-muted break-words [overflow-wrap:anywhere]">
          {conf.valid ? `Site confirmado (${conf.source ?? '—'}) em ${fmtTime(conf.confirmedAt)}, revalidado em ${fmtTime(conf.revalidatedAt)}: ` : conf.url ? `Confirmação anterior NÃO vigente${conf.legacy ? ' (legado, sem evidência)' : ''}: ` : ''}
          {conf.url && <a href={conf.url} target="_blank" rel="noreferrer" className="text-orange-700 dark:text-orange-300 hover:underline">{conf.url}</a>}
        </p>
      )}

      {(st !== 'DONE' || waiting) && lead.investigationState && (
        <div className="rounded-xl border border-border px-3 py-2 text-xs text-fg-muted flex flex-col gap-0.5 min-w-0 break-words [overflow-wrap:anywhere]">
          <span><b className="text-fg">{PROGRESS_LABEL[st]}</b>{lead.investigationNextAction ? ` · próxima ação: ${actionLabel(lead.investigationNextAction)}` : ''}</span>
          {lead.investigationWaitReason && <span>Motivo: {lead.investigationWaitReason}</span>}
          {waiting && lead.investigationNextRunAt && <span>Retoma automaticamente em {fmtTime(lead.investigationNextRunAt)} (tentativas: {lead.investigationAttempts}).</span>}
          {st === 'MANUAL_REVIEW' && <span>Investigação esgotada: confira o site candidato à mão (use "Site próprio" abaixo para confirmar).</span>}
          {lead.investigationLastError && <span>Último erro: {lead.investigationLastError}</span>}
        </div>
      )}

      {cov?.blocked && cov.blocked.length > 0 && <p className="text-xs text-tone-amber-fg break-words [overflow-wrap:anywhere]">Etapas pendentes por bloqueio: {cov.blocked.map((b) => `${actionLabel(b.step) || b.step} (${b.code})`).join(', ')}. Cota esgotada ou erro nunca contam como "sem site".</p>}

      <div className="rounded-xl border border-border px-3 py-2 text-xs flex flex-col gap-1.5 min-w-0 break-words [overflow-wrap:anywhere]">
        <b className="text-fg">Evidências por fonte <span className="font-normal text-fg-muted">(não são a decisão final)</span></b>
        {sourceEvidence(lead).map((e) => (
          <p key={e.source} className="text-fg-muted break-words [overflow-wrap:anywhere]"><span className="text-fg">{e.source}:</span> {e.text}{e.at ? ` · coletado em ${fmtTime(e.at)}` : ''}{e.fromCache ? ' · do cache' : ''}</p>
        ))}
        <span className="inline-flex flex-wrap items-center gap-1.5 text-fg-muted">Presença digital (Google): <SitePill status={lead.statusSite} reason={lead.siteCheckReason} /></span>
      </div>

      {evid.length > 0 && (
        <details className="text-xs text-fg-muted">
          <summary className="cursor-pointer text-fg">Evidências ({evid.length})</summary>
          <ul className="mt-1.5 flex flex-col gap-1">
            {evid.map((e, i) => (
              <li key={i} className="break-words [overflow-wrap:anywhere]">
                <span className="text-fg">{e.type}</span> {e.value ? `· ${e.value}` : ''} <span className="tabular-nums">({e.confidence >= 0 ? '+' : ''}{e.confidence})</span>
                {e.at ? ` · ${fmtTime(e.at)}` : ''}{e.fromCache ? ' · reutilizada do cache (coleta original acima)' : ''}
              </li>
            ))}
          </ul>
        </details>
      )}
    </Section>
  )
}

export function LeadDrawer({ lead, focusNotes, saving, onClose, onSaveNotes, onContato, onSaveLinks, onConvert }: {
  onConvert?: (lead: Lead) => void
  lead: Lead | null
  focusNotes: boolean
  saving: boolean
  onClose: () => void
  onSaveNotes: (lead: Lead, text: string) => Promise<void>
  onContato: (lead: Lead, status: StatusContato) => void
  onSaveLinks: (lead: Lead, data: { foundWebsite?: string | null; instagramHandle?: string | null }) => Promise<void>
}) {
  const [notes, setNotes] = useState('')
  const [site, setSite] = useState('')
  const [handle, setHandle] = useState('')
  const notesRef = useRef<HTMLTextAreaElement>(null)
  const leadId = lead?.id

  useEffect(() => {
    setNotes(lead?.notes ?? '')
  }, [leadId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setSite(lead?.foundWebsite ?? '')
    setHandle(lead?.instagramHandle ? `@${lead.instagramHandle}` : '')
  }, [leadId, lead?.foundWebsite, lead?.instagramHandle]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (leadId && focusNotes) setTimeout(() => notesRef.current?.focus(), 50)
  }, [leadId, focusNotes])

  useEffect(() => {
    if (!lead) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [lead, onClose])

  if (!lead) return null
  const links = leadLinks(lead)
  const siteUrl = lead.siteUrl ?? lead.destinoReal
  const outros = lead.linksEncontrados?.outros ?? []
  const dirty = notes.trim() !== (lead.notes ?? '')
  const siteDirty = site.trim() !== (lead.foundWebsite ?? '')
  const handleDirty = handle.trim().replace(/^@/, '') !== (lead.instagramHandle ?? '')
  const saveLinks = () => onSaveLinks(lead, {
    ...(siteDirty ? { foundWebsite: site.trim() || null } : {}),
    ...(handleDirty ? { instagramHandle: handle.trim() || null } : {}),
  })
  const inputClass = 'w-full text-sm rounded-xl border border-border bg-surface text-fg placeholder:text-fg-muted px-3 py-2 outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-400'
  const linkClass = 'inline-flex items-center gap-2 text-sm text-orange-700 dark:text-orange-300 hover:underline min-w-0'

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label={`Detalhes de ${lead.arenaName}`}>
      <div className="absolute inset-0 bg-overlay/40" onClick={onClose} />
      <aside className="relative w-full max-w-md h-full bg-surface border-l border-border shadow-xl flex flex-col">
        <header className="flex items-start gap-3 p-5 border-b border-border">
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-fg truncate" title={lead.arenaName}>{lead.arenaName}</h2>
            <ClassificationPill lead={lead} className="mt-1.5" />
            <OwnerGroupBadge lead={lead} className="mt-1.5" />
            <SiteExtras lead={lead} className="mt-1.5" />
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar" className="p-1.5 rounded-lg text-fg-muted hover:bg-surface-hover"><X size={18} /></button>
        </header>

        <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-6">
          <ClassificationSection lead={lead} />

          <Section title="Endereço">
            <p className="text-sm text-fg">{lead.address || [lead.city, lead.state].filter(Boolean).join(' - ') || 'Sem endereço'}</p>
            {lead.googleMapsUrl && <a href={lead.googleMapsUrl} target="_blank" rel="noreferrer" className={linkClass}><MapPin size={14} /> Abrir no Google Maps</a>}
          </Section>

          <Section title="Links encontrados">
            {links.length === 0 && !siteUrl && outros.length === 0 && <p className="text-sm text-fg-muted">Nenhum link encontrado.</p>}
            <ul className="flex flex-col gap-1.5">
              {siteUrl && <li><a href={siteUrl} target="_blank" rel="noreferrer" className={linkClass}><Globe size={14} className="shrink-0" /><span className="truncate">{siteUrl}</span></a></li>}
              {links.map(({ key, label, href, Icon }) => (
                <li key={key}><a href={href} target="_blank" rel="noreferrer" className={linkClass}><Icon size={14} className="shrink-0" />{label}</a></li>
              ))}
              {outros.map((u) => <li key={u}><a href={u} target="_blank" rel="noreferrer" className={linkClass}><ExternalLink size={14} className="shrink-0" /><span className="truncate">{u}</span></a></li>)}
            </ul>
            <p className="text-xs text-fg-muted">
              {lead.fonte ? `Fonte: ${lead.fonte === 'maps' ? 'Google Maps' : 'página de link na bio'}. ` : ''}Verificado em {fmt(lead.verificadoEm)}.
            </p>
          </Section>

          <Section title="Site e Instagram">
            <label className="flex flex-col gap-1 text-xs font-medium text-fg-muted">Site próprio {lead.siteManual && '(manual)'}
              <input value={site} onChange={(e) => setSite(e.target.value)} placeholder="https://exemplo.com.br" className={inputClass} />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-fg-muted">Instagram {lead.instagramManual && '(manual)'}
              <input value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="@exemplo" className={inputClass} />
            </label>
            {(instagramStats(lead) || lead.businessDiscoveryCheckedAt) && (
              <p className="text-xs text-fg-muted">
                Perfil do Instagram: {instagramStats(lead) ?? 'sem dados (conta pessoal ou não encontrada)'}
                {lead.businessDiscoveryCheckedAt && ` · consultado em ${fmt(lead.businessDiscoveryCheckedAt)}`}
              </p>
            )}
            <p className="text-xs text-fg-muted">Valores informados aqui não são sobrescritos por buscas futuras. Vazio volta ao automático.</p>
            <div className="flex justify-end">
              <Button onClick={saveLinks} loading={saving} disabled={!siteDirty && !handleDirty}>Salvar e reclassificar</Button>
            </div>
          </Section>

          <Section title="Contato">
            <label className="flex flex-col gap-1 text-xs font-medium text-fg-muted">Status de contato
              <select value={lead.status} onChange={(e) => onContato(lead, e.target.value as StatusContato)} className={selectClass}>
                {CONTATO_OPTIONS.map((s) => <option key={s} value={s}>{CONTATO_LABEL[s]}</option>)}
              </select>
            </label>
            <p className="text-xs text-fg-muted">
              Responsável: {lead.responsavelNome ?? 'ninguém'} · No sistema desde {fmt(lead.createdAt)}. Ao marcar "Negociando" ou "Fechado", o prospect entra no funil de vendas automaticamente.
            </p>
            {onConvert && (
              <div className="flex items-center gap-3 pt-1">
                <Button size="sm" variant={lead.convertedLeadId ? 'secondary' : 'primary'} onClick={() => onConvert(lead)} disabled={saving}>
                  {lead.convertedLeadId ? 'Abrir lead no funil' : 'Converter em lead do funil'}
                </Button>
                {lead.convertedLeadId && <span className="text-xs text-fg-muted">Já está no funil comercial.</span>}
              </div>
            )}
          </Section>

          <Section title="Notas">
            <textarea
              ref={notesRef}
              rows={5}
              maxLength={2000}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Anote o que foi combinado com esse lead"
              className="w-full text-sm rounded-xl border border-border bg-surface text-fg placeholder:text-fg-muted px-3 py-2 outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-400"
            />
            <div className="flex justify-end">
              <Button onClick={() => onSaveNotes(lead, notes)} loading={saving} disabled={!dirty}>Salvar notas</Button>
            </div>
          </Section>
        </div>
      </aside>
    </div>
  )
}
