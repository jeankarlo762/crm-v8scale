import { useEffect, useState, type RefObject } from 'react'
import { listUsers } from '../../../api/users.api'
import { Globe, Instagram, Link2, BedDouble, MessageCircle, Users, TriangleAlert } from 'lucide-react'
import { listDecision, LIST_DECISION_LABEL, LIST_DECISION_PILL, LIST_DECISION_DOT } from './classification'
import type { Lead, StatusSite, StatusContato, Responsavel, InvestigationState, DecisionFilter, ProgressFilter } from '../../../api/lead.api'

export const SITE_LABEL: Record<StatusSite, string> = {
  sem_site: 'Sem site',
  so_instagram: 'Só Instagram',
  so_facebook: 'Só Facebook',
  link_bio: 'Só link na bio',
  so_ota: 'Só Booking/Airbnb',
  site_proprio: 'Site próprio',
  fora_do_ar: 'Site fora do ar',
  sem_https: 'Sem HTTPS',
  certificado_invalido: 'Problema no certificado',
  verificar: 'Site a confirmar',
}

// Pill de presença digital. Sem site (laranja) é o lead mais quente; Site próprio (cinza) o menos interessante.
export const SITE_PILL: Record<StatusSite, string> = {
  sem_site: 'bg-tone-orange-solid/15 text-tone-orange-fg',
  so_instagram: 'bg-tone-purple-solid/15 text-tone-purple-fg',
  so_facebook: 'bg-tone-indigo-solid/15 text-tone-indigo-fg',
  link_bio: 'bg-tone-sky-solid/15 text-tone-sky-fg',
  so_ota: 'bg-tone-blue-solid/15 text-tone-blue-fg',
  site_proprio: 'bg-tone-gray-solid/15 text-fg-muted',
  fora_do_ar: 'bg-tone-red-solid/15 text-tone-red-fg',
  sem_https: 'bg-tone-amber-solid/15 text-tone-amber-fg',
  certificado_invalido: 'bg-tone-amber-solid/15 text-tone-amber-fg',
  verificar: 'bg-tone-amber-solid/15 text-tone-amber-fg',
}
export const SITE_DOT: Record<StatusSite, string> = {
  sem_site: 'bg-tone-orange-solid',
  so_instagram: 'bg-tone-purple-solid',
  so_facebook: 'bg-tone-indigo-solid',
  link_bio: 'bg-tone-sky-solid',
  so_ota: 'bg-tone-blue-solid',
  site_proprio: 'bg-tone-gray-solid',
  fora_do_ar: 'bg-tone-red-solid',
  sem_https: 'bg-tone-amber-solid',
  certificado_invalido: 'bg-tone-amber-solid',
  verificar: 'bg-tone-amber-solid',
}

// Fundo do card de métrica ativo, no tom do próprio status.
export const SITE_TINT: Record<StatusSite | 'all', string> = {
  all: 'bg-fg/[0.05]',
  sem_site: 'bg-tone-orange-solid/[0.09]',
  so_instagram: 'bg-tone-purple-solid/[0.09]',
  so_facebook: 'bg-tone-indigo-solid/[0.09]',
  link_bio: 'bg-tone-sky-solid/[0.09]',
  so_ota: 'bg-tone-blue-solid/[0.09]',
  site_proprio: 'bg-tone-gray-solid/[0.09]',
  fora_do_ar: 'bg-tone-red-solid/[0.09]',
  sem_https: 'bg-tone-amber-solid/[0.09]',
  certificado_invalido: 'bg-tone-amber-solid/[0.09]',
  verificar: 'bg-tone-amber-solid/[0.09]',
}

// "sem_site" com site próprio já achado e confirmado na busca (foundWebsite):
// não é o mesmo lead frio de "sem site nenhum" — cor própria (teal) pra dar
// pra diferenciar só de bater o olho, sem precisar ler a linha pequena embaixo.
export function isSiteAchadoForaDoGoogle(l: { statusSite: StatusSite; foundWebsite: string | null; foundWebsiteVerificar: boolean; foundSiteStatus: string | null }): boolean {
  return l.statusSite === 'sem_site' && !!l.foundWebsite && !l.foundWebsiteVerificar && l.foundSiteStatus === 'ok'
}

const SITE_ACHADO_LABEL = 'Site achado (fora do Google)'
const SITE_ACHADO_PILL = 'bg-tone-pink-solid/15 text-tone-pink-fg'
const SITE_ACHADO_DOT = 'bg-tone-pink-solid'

export function SitePill({ status, className, reason, foundWebsite, foundWebsiteVerificar, foundSiteStatus }: {
  status: StatusSite
  className?: string
  reason?: string | null
  foundWebsite?: string | null
  foundWebsiteVerificar?: boolean
  foundSiteStatus?: string | null
}) {
  const achado = isSiteAchadoForaDoGoogle({ statusSite: status, foundWebsite: foundWebsite ?? null, foundWebsiteVerificar: !!foundWebsiteVerificar, foundSiteStatus: foundSiteStatus ?? null })
  return (
    <span title={reason ?? undefined} className={`inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-medium rounded-full pl-2 pr-2.5 py-1 ${achado ? SITE_ACHADO_PILL : SITE_PILL[status]} ${className ?? ''}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${achado ? SITE_ACHADO_DOT : SITE_DOT[status]}`} />
      {achado ? SITE_ACHADO_LABEL : SITE_LABEL[status]}
    </span>
  )
}

// ── Decisão × andamento ─────────────────────────────────────────────────────────────────────
export const DECISION_LABEL: Record<DecisionFilter, string> = {
  PROBABLY_NO_WEBSITE: 'Provavelmente sem site', SOCIAL_ONLY: 'Somente redes sociais', HAS_WEBSITE: 'Site confirmado', UNKNOWN: 'Em análise', CONFLICT: 'Revisar: conflito de site', SEM_DECISAO: 'Em análise (sem decisão)',
}
export const DECISION_PILL: Record<DecisionFilter, string> = {
  PROBABLY_NO_WEBSITE: 'bg-tone-orange-solid/15 text-tone-orange-fg', SOCIAL_ONLY: 'bg-tone-purple-solid/15 text-tone-purple-fg', HAS_WEBSITE: 'bg-tone-gray-solid/15 text-fg-muted',
  UNKNOWN: 'bg-tone-amber-solid/15 text-tone-amber-fg', CONFLICT: 'bg-tone-red-solid/15 text-tone-red-fg', SEM_DECISAO: 'bg-tone-gray-solid/10 text-fg-muted',
}
export const DECISION_DOT: Record<DecisionFilter, string> = {
  PROBABLY_NO_WEBSITE: 'bg-tone-orange-solid', SOCIAL_ONLY: 'bg-tone-purple-solid', HAS_WEBSITE: 'bg-tone-gray-solid', UNKNOWN: 'bg-tone-amber-solid', CONFLICT: 'bg-tone-red-solid', SEM_DECISAO: 'bg-tone-gray-solid',
}
export const DECISION_OPTIONS: DecisionFilter[] = ['PROBABLY_NO_WEBSITE', 'SOCIAL_ONLY', 'UNKNOWN', 'CONFLICT', 'HAS_WEBSITE', 'SEM_DECISAO']

export const PROGRESS_LABEL: Record<ProgressFilter, string> = {
  PENDING: 'Na fila', PROCESSING: 'Processando', WAITING_QUOTA: 'Aguardando cota', WAITING_RETRY: 'Aguardando nova tentativa', DONE: 'Concluído', MANUAL_REVIEW: 'Revisão manual', LEGADO: 'Não investigado',
}
export const PROGRESS_PILL: Record<ProgressFilter, string> = {
  PENDING: 'bg-tone-sky-solid/15 text-tone-sky-fg', PROCESSING: 'bg-tone-blue-solid/15 text-tone-blue-fg', WAITING_QUOTA: 'bg-tone-amber-solid/15 text-tone-amber-fg',
  WAITING_RETRY: 'bg-tone-amber-solid/15 text-tone-amber-fg', DONE: 'bg-tone-green-solid/15 text-tone-green-fg', MANUAL_REVIEW: 'bg-tone-red-solid/15 text-tone-red-fg', LEGADO: 'bg-tone-gray-solid/10 text-fg-muted',
}
export const PROGRESS_OPTIONS: ProgressFilter[] = ['WAITING_QUOTA', 'WAITING_RETRY', 'MANUAL_REVIEW', 'PENDING', 'PROCESSING', 'DONE', 'LEGADO']

export const decisionOf = (l: Pick<Lead, 'websiteStatus'>): DecisionFilter => l.websiteStatus ?? 'SEM_DECISAO'
export const progressOf = (l: Pick<Lead, 'investigationState'>): ProgressFilter => l.investigationState ?? 'LEGADO'

// Motivos (códigos do backend) em português. Sem mapa, mostra o código.
const REASON_LABEL: Record<string, string> = {
  IDENTITY_CONFIRMED: 'Site confirmado por telefone/endereço/Instagram + nome', MANUAL_CONFIRMED: 'Site informado e confirmado à mão',
  NO_SITE_AFTER_FULL_INVESTIGATION: 'Investigação completa sem nenhum site vinculado', SOCIAL_CONFIRMED_NO_SITE: 'Rede social confirmada e nenhum site achado',
  CANDIDATE_UNCONFIRMED: 'Há um site candidato, mas a identidade não foi confirmada', CANDIDATE_NOT_EVALUABLE: 'Site candidato não pôde ser avaliado (bloqueio, JS ou fora do ar)',
  CANDIDATE_INCONCLUSIVE: 'Site candidato sem sinais suficientes (sem telefone/nome/endereço)', BRAND_OTHER_UNIT: 'Parece outra unidade da mesma marca — verificar',
  PREVIOUS_CONFIRMATION_UNVERIFIED: 'Site confirmado antes, ainda não revalidado', PLAUSIBLE_CANDIDATES_INCOMPATIBLE: 'Dois sites plausíveis e incompatíveis',
  INSUFFICIENT_EVIDENCE: 'Evidência insuficiente — investigação em andamento', INVESTIGATION_INTERRUPTED: 'Investigação interrompida (cota, erro ou bloqueio) — não é "sem site"',
}
export const reasonLabel = (code: string | null | undefined): string => (code ? REASON_LABEL[code] ?? code : '')

const ACTION_LABEL: Record<string, string> = {
  PAGE_CHECK: 'Ler o site candidato', LINK_RESOLVE: 'Abrir o link na bio', META_BIO: 'Ler a bio do Instagram', TAVILY_NAME: 'Buscar por nome + cidade', TAVILY_PHONE: 'Buscar pelo telefone',
  TAVILY_HANDLE: 'Buscar pelo @', TAVILY_ADDRESS: 'Buscar pelo endereço', TAVILY_INSTAGRAM: 'Buscar o Instagram', RECOMPUTE: 'Recalcular', MANUAL_REVIEW: 'Conferir à mão',
}
export const actionLabel = (a: string | null | undefined): string => (a ? ACTION_LABEL[a] ?? a : '')

export function DecisionPill({ lead, className }: { lead: Lead; className?: string }) {
  const d = decisionOf(lead)
  const conf = lead.websiteConfidence != null && lead.websiteStatus ? ` · confiança ${Math.round(lead.websiteConfidence * 100)}% (heurística)` : ''
  return (
    <span title={`${reasonLabel(lead.websiteReason)}${conf}`.trim() || undefined} className={`inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-medium rounded-full pl-2 pr-2.5 py-1 ${DECISION_PILL[d]} ${className ?? ''}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${DECISION_DOT[d]}`} />
      {DECISION_LABEL[d]}
    </span>
  )
}

// Única classificação principal da lista: a decisão final acionável (evidências por fonte ficam na gaveta).
export function ClassificationPill({ lead, className }: { lead: Lead; className?: string }) {
  const k = listDecision(lead)
  const conf = lead.websiteConfidence != null && lead.websiteStatus ? ` · confiança ${Math.round(lead.websiteConfidence * 100)}% (heurística)` : ''
  const when = lead.investigationNextRunAt && (lead.investigationState === 'WAITING_QUOTA' || lead.investigationState === 'WAITING_RETRY') ? ` · volta em ${new Date(lead.investigationNextRunAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}` : ''
  const why = [lead.investigationWaitReason, lead.investigationNextAction ? `Próxima ação: ${actionLabel(lead.investigationNextAction)}` : ''].filter(Boolean).join(' — ')
  const title = [`${reasonLabel(lead.websiteReason)}${conf}${when}`.trim(), k === 'IN_ANALYSIS' ? why : ''].filter(Boolean).join(' — ') || undefined
  return (
    <span title={title} data-decision={k} className={`inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-medium rounded-full pl-2 pr-2.5 py-1 ${LIST_DECISION_PILL[k]} ${className ?? ''}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${LIST_DECISION_DOT[k]}`} />
      {LIST_DECISION_LABEL[k]}
    </span>
  )
}

// Andamento: aguardando cota ≠ revisão manual ≠ concluído. Concluído e legado ficam discretos.
export function ProgressBadge({ lead, className }: { lead: Lead; className?: string }) {
  const st = lead.investigationState as InvestigationState | null
  if (!st || st === 'DONE') return null
  const when = lead.investigationNextRunAt && (st === 'WAITING_QUOTA' || st === 'WAITING_RETRY') ? ` · volta em ${new Date(lead.investigationNextRunAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}` : ''
  const why = [lead.investigationWaitReason, lead.investigationNextAction ? `Próxima ação: ${actionLabel(lead.investigationNextAction)}` : ''].filter(Boolean).join(' — ')
  return (
    <span title={why || undefined} className={`inline-flex items-center gap-1 whitespace-nowrap text-[11px] font-medium rounded-full px-2 py-0.5 ${PROGRESS_PILL[st]} ${className ?? ''}`}>
      {PROGRESS_LABEL[st]}{when}
    </span>
  )
}

export const SITE_OPTIONS: StatusSite[] = ['sem_site', 'so_instagram', 'so_facebook', 'link_bio', 'so_ota', 'fora_do_ar', 'sem_https', 'certificado_invalido', 'verificar', 'site_proprio']
export const SITE_FILTER_DEFAULT: StatusSite[] = ['sem_site', 'so_instagram', 'so_facebook', 'link_bio', 'so_ota', 'fora_do_ar', 'sem_https', 'certificado_invalido', 'verificar']

export type Ordem = 'prioridade' | 'nota' | 'avaliacoes' | 'nome'
export const ORDEM_LABEL: Record<Ordem, string> = { prioridade: 'Prioridade', nota: 'Nota', avaliacoes: 'Avaliações', nome: 'Nome' }

export function compareByOrdem(ordem: Ordem, a: Lead, b: Lead): number {
  if (ordem === 'nota') return (b.avaliacao ?? 0) - (a.avaliacao ?? 0)
  if (ordem === 'avaliacoes') return (b.numAvaliacoes ?? 0) - (a.numAvaliacoes ?? 0)
  if (ordem === 'nome') return a.arenaName.localeCompare(b.arenaName, 'pt-BR')
  return b.leadScore - a.leadScore
}

export function hostLabel(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return url }
}

export const CONTATO_LABEL: Record<StatusContato, string> = {
  nao_contatado: 'Não contatado', contato_1: 'Contato 1', contato_2: 'Contato 2', contato_3: 'Contato 3', sem_retorno: 'Sem retorno',
  negociando: 'Negociando', fechado: 'Fechado', recusado: 'Recusado',
}
export const CONTATO_COLOR: Record<StatusContato, string> = {
  nao_contatado: 'bg-tone-gray-solid/15 text-fg-muted',
  contato_1: 'bg-tone-sky-solid/15 text-tone-sky-fg',
  contato_2: 'bg-tone-indigo-solid/15 text-tone-indigo-fg',
  contato_3: 'bg-tone-purple-solid/15 text-tone-purple-fg',
  sem_retorno: 'bg-tone-slate-solid/15 text-tone-slate-fg',
  negociando: 'bg-tone-blue-solid/15 text-tone-blue-fg',
  fechado: 'bg-tone-green-solid/15 text-tone-green-fg',
  recusado: 'bg-tone-red-solid/15 text-tone-red-fg',
}
export const CONTATO_OPTIONS: StatusContato[] = ['nao_contatado', 'contato_1', 'contato_2', 'contato_3', 'sem_retorno', 'negociando', 'fechado', 'recusado']
// Responsáveis = usuários ativos do CRM (carregados uma vez por sessão; só ADMIN/MANAGER chegam aqui).
export interface ResponsavelOption { id: string; name: string }
let responsaveisCache: ResponsavelOption[] | null = null
export function useResponsaveis(): ResponsavelOption[] {
  const [list, setList] = useState<ResponsavelOption[]>(responsaveisCache ?? [])
  useEffect(() => {
    if (responsaveisCache) return
    listUsers()
      .then((users) => {
        responsaveisCache = users.filter((u) => u.active).map(({ id, name }) => ({ id, name }))
        setList(responsaveisCache)
      })
      .catch(() => undefined)
  }, [])
  return list
}
/** Itens de menu "atribuir responsável" (um por usuário). */
export function ResponsavelMenuItems({ onSelect }: { onSelect: (id: Responsavel) => void }) {
  const responsaveis = useResponsaveis()
  return (
    <>
      {responsaveis.map((u) => (
        <button key={u.id} role="menuitem" className={menuItemClass} onClick={() => onSelect(u.id)}>{u.name}</button>
      ))}
    </>
  )
}
/** <option> por usuário, para <select> de filtro. */
export function ResponsavelOptionTags() {
  const responsaveis = useResponsaveis()
  return <>{responsaveis.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</>
}
export const NOTA_OPTIONS = [3, 3.5, 4, 4.5]
export const PAGE_SIZES = [25, 50, 100, 200]

export const selectClass = 'text-sm rounded-xl border border-border bg-surface text-fg px-3 py-2 outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100 dark:focus:ring-orange-900/30'
export const inputClass = 'w-full text-sm rounded-xl border border-border bg-surface text-fg placeholder:text-fg-muted px-3 py-2.5 outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100 dark:focus:ring-orange-900/30'
export const compactSelectClass = 'text-xs rounded-lg border border-border bg-surface text-fg px-2 py-1 outline-none cursor-pointer focus:border-orange-400'
export const menuClass = 'absolute z-30 mt-1.5 min-w-[11rem] rounded-xl border border-border bg-surface shadow-lg py-1'
export const menuItemClass = 'flex w-full items-center gap-2 px-3 py-2 text-sm text-left text-fg hover:bg-surface-hover disabled:opacity-40'

export interface Filters {
  estado: string
  cidade: string
  contato: StatusContato | ''
  responsavel: Responsavel | 'nenhum' | ''
  notaMin: string
  avalMin: string
  avalMax: string
  soCelular: boolean
}
export const EMPTY_FILTERS: Filters = { estado: '', cidade: '', contato: '', responsavel: '', notaMin: '', avalMin: '', avalMax: '', soCelular: false }

// Selo de leads com o mesmo telefone (provável mesmo dono); os outros nomes ficam no tooltip.
export function OwnerGroupBadge({ lead, className }: { lead: Lead; className?: string }) {
  const n = lead.ownerGroupSize ?? 1
  if (n < 2) return null
  const outros = lead.ownerGroupNames ?? []
  return (
    <span title={outros.length ? `Também: ${outros.join(', ')}` : undefined}
      className={`inline-flex items-center gap-1 rounded-full bg-tone-purple-solid/15 text-tone-purple-solid dark:text-tone-purple-fg text-[11px] font-medium px-2 py-0.5 ${className ?? ''}`}>
      <Users size={11} className="shrink-0" />Mesmo dono de {n} negócios
    </span>
  )
}

export function instagramLabel(url: string): string {
  const m = url.match(/instagram\.com\/([^/?#]+)/i)
  return m ? `@${m[1]}` : url
}

// Dígitos do número pro wa.me: E.164 quando existe (funciona em qualquer país); senão assume Brasil.
export function whatsappDigits(lead: Lead): string | null {
  if (lead.phoneE164) return lead.phoneE164.replace(/\D/g, '')
  if (!lead.whatsapp) return null
  const d = lead.whatsapp.replace(/\D/g, '')
  if (d.length < 10) return null
  return d.startsWith('55') && d.length >= 12 ? d : `55${d}`
}

// Celular por regra do país (BR: 9º dígito; AR: +54 9...) vem do backend; sem isso, heurística brasileira.
export function isMobilePhone(lead: Lead): boolean {
  if (lead.phoneMobile != null) return lead.phoneMobile
  const d = (lead.whatsapp ?? '').replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '')
  return d.length === 11 && d[2] === '9'
}

// Bandeira (emoji) a partir do código do país: BR -> 🇧🇷. Brasil não precisa de destaque.
export function countryFlag(code: string | null): string | null {
  if (!code || code === 'BR' || !/^[A-Z]{2}$/.test(code)) return null
  return String.fromCodePoint(...[...code].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65))
}

export function whatsappLink(lead: Lead): string | null {
  const digits = whatsappDigits(lead)
  if (!digits) return null
  const msg = `Olá! Encontrei a ${lead.arenaName} no Google e queria conversar rapidinho sobre a presença digital de vocês. Posso falar com o responsável?`
  return `https://wa.me/${digits}?text=${encodeURIComponent(msg)}`
}

export interface LeadLink { key: string; label: string; href: string; Icon: typeof Globe }

// Links de contato do lead: só os que existem. WhatsApp usa o telefone do Maps.
export function leadLinks(lead: Lead): LeadLink[] {
  const found = lead.linksEncontrados ?? {}
  const out: LeadLink[] = []
  const wa = whatsappLink(lead)
  if (wa) out.push({ key: 'whatsapp', label: 'WhatsApp', href: wa, Icon: MessageCircle })
  const insta = lead.instagramHandle ? `https://instagram.com/${lead.instagramHandle}` : (found.instagram ?? lead.instagram)
  if (insta) out.push({ key: 'instagram', label: 'Instagram', href: /^https?:\/\//i.test(insta) ? insta : `https://${insta}`, Icon: Instagram })
  if (found.linktree) out.push({ key: 'linktree', label: 'Linktree', href: found.linktree, Icon: Link2 })
  if (found.booking) out.push({ key: 'booking', label: 'Booking', href: found.booking, Icon: BedDouble })
  return out
}

export function useClickOutside(ref: RefObject<HTMLElement | null>, onOutside: () => void, active: boolean) {
  useEffect(() => {
    if (!active) return
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onOutside() }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [ref, onOutside, active])
}

const nfmt = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 })
export function instagramStats(lead: Pick<Lead, 'instagramFollowers' | 'instagramMediaCount'>): string | null {
  const parts = [
    lead.instagramFollowers != null ? `${nfmt.format(lead.instagramFollowers)} seg.` : null,
    lead.instagramMediaCount != null ? `${nfmt.format(lead.instagramMediaCount)} posts` : null,
  ].filter(Boolean)
  return parts.length ? parts.join(' · ') : null
}

// @ do Instagram (clicável) e site achado via busca/link na bio, sob a pill de presença digital.
export function SiteExtras({ lead, className }: { lead: Lead; className?: string }) {
  const found = lead.foundWebsite
  // Site cadastrado no Google mas com problema: mostra o domínio pra dar pra abrir e conferir.
  const googleSiteRaw = (lead.statusSite === 'sem_https' || lead.statusSite === 'fora_do_ar' || lead.statusSite === 'certificado_invalido') ? (lead.siteUrl ?? lead.website) : null
  // foundWebsite igual ao site do Google: mostra uma vez só (a linha do achado carrega o aviso de saúde).
  const googleSite = googleSiteRaw && found && hostLabel(googleSiteRaw).replace(/^www\./, '') === hostLabel(found).replace(/^www\./, '') ? null : googleSiteRaw
  if (!lead.instagramHandle && !found && !googleSite && !lead.enrichError) return null
  const stats = instagramStats(lead)
  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation()
  const health = lead.foundSiteStatus && lead.foundSiteStatus !== 'ok'
    ? ({ fora_do_ar: 'fora do ar', sem_https: 'sem HTTPS', dominio_parado: 'domínio parado', certificado_invalido: 'problema no certificado' } as const)[lead.foundSiteStatus]
    : null
  return (
    <div className={`flex flex-col gap-0.5 text-xs min-w-0 ${className ?? ''}`}>
      {lead.instagramHandle && (
        <a href={`https://instagram.com/${lead.instagramHandle}`} target="_blank" rel="noreferrer" onClick={stop}
          className="inline-flex items-center gap-1 text-tone-purple-solid dark:text-tone-purple-fg hover:underline truncate">
          <Instagram size={11} className="shrink-0" />@{lead.instagramHandle}
          {lead.instagramVerificar && <span className="shrink-0 text-tone-amber-fg">(possível @, confirmar)</span>}
        </a>
      )}
      {stats && <span className="truncate text-fg-muted/80" title="Dados do perfil (Instagram Business Discovery)">{stats}</span>}
      {googleSite && (
        <a href={/^https?:\/\//i.test(googleSite) ? googleSite : `http://${googleSite}`} target="_blank" rel="noreferrer" onClick={stop} title={googleSite}
          className="inline-flex items-center gap-1 min-w-0 text-fg-muted hover:text-fg hover:underline">
          <Globe size={11} className="shrink-0" />
          <span className="truncate">{hostLabel(googleSite)}</span>
        </a>
      )}
      {found && (
        <>
          <a href={found} target="_blank" rel="noreferrer" onClick={stop} title={found}
            className="inline-flex items-center gap-1 min-w-0 text-fg-muted hover:text-fg hover:underline">
            <Globe size={11} className="shrink-0" />
            <span className="truncate">{hostLabel(found)}</span>
          </a>
          {lead.foundWebsiteVerificar ? (
            <span className="inline-flex items-center gap-1 truncate font-medium text-tone-amber-fg" title={`Achei este site, mas não confirmei que é do negócio. ${lead.foundSiteCheckReason ?? ''}`.trim()}>
              <TriangleAlert size={11} className="shrink-0" />possível site{lead.foundWebsiteSource === 'instagram' ? ' (bio do Instagram)' : ''}, confirmar{health ? `, ${health}` : ''}
            </span>
          ) : (
            <span className="truncate text-fg-muted/80" title={lead.foundSiteCheckReason ?? found}>
              {lead.foundWebsiteSource === 'instagram' ? 'via bio do Instagram' : lead.foundWebsiteSource === 'link_na_bio' ? 'via link na bio' : 'não cadastrado no Google'}{health ? `, ${health}` : ''}
            </span>
          )}
        </>
      )}
      {lead.enrichError && (
        <span className="inline-flex items-center gap-1 text-fg-muted" title={`Erro na busca da última tentativa, será retentado. (${lead.enrichError})`}>
          <TriangleAlert size={11} className="shrink-0" />Erro na busca, será retentado
        </span>
      )}
    </div>
  )
}

export function normalizeSearch(s: string) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

/** Destaca o trecho de `text` que bate com `query` (sem acento, sem caixa). */
export function Highlight({ text, query }: { text: string; query: string }) {
  const q = normalizeSearch(query.trim())
  if (!q) return <>{text}</>
  // Normaliza char a char pra manter os índices alinhados com o texto original.
  let norm = ''
  const map: number[] = []
  for (let i = 0; i < text.length; i++) {
    const n = normalizeSearch(text[i])
    for (let k = 0; k < n.length; k++) { norm += n[k]; map.push(i) }
  }
  const at = norm.indexOf(q)
  if (at < 0) return <>{text}</>
  const start = map[at]
  const end = map[at + q.length - 1] + 1
  return (
    <>
      {text.slice(0, start)}
      <mark className="bg-orange-200 dark:bg-orange-500/30 text-inherit rounded-sm px-0.5">{text.slice(start, end)}</mark>
      {text.slice(end)}
    </>
  )
}
