import type { Lead } from '../../../api/lead.api'

// Decisão FINAL mostrada na lista (uma só por lead). Evidências por fonte (Google, Tavily, Meta) ficam só na gaveta.
export type ListDecisionKey = 'HAS_WEBSITE' | 'PROBABLY_NO_WEBSITE' | 'SOCIAL_ONLY' | 'IN_ANALYSIS' | 'CONFLICT'

export const LIST_DECISION_LABEL: Record<ListDecisionKey, string> = {
  HAS_WEBSITE: 'Site confirmado',
  PROBABLY_NO_WEBSITE: 'Provavelmente sem site',
  SOCIAL_ONLY: 'Somente redes sociais',
  IN_ANALYSIS: 'Em análise',
  CONFLICT: 'Revisar: conflito de site',
}
export const LIST_DECISION_PILL: Record<ListDecisionKey, string> = {
  HAS_WEBSITE: 'bg-tone-gray-solid/15 text-fg-muted',
  PROBABLY_NO_WEBSITE: 'bg-tone-orange-solid/15 text-tone-orange-fg',
  SOCIAL_ONLY: 'bg-tone-purple-solid/15 text-tone-purple-fg',
  IN_ANALYSIS: 'bg-tone-amber-solid/15 text-tone-amber-fg',
  CONFLICT: 'bg-tone-red-solid/15 text-tone-red-fg',
}
export const LIST_DECISION_DOT: Record<ListDecisionKey, string> = {
  HAS_WEBSITE: 'bg-tone-gray-solid', PROBABLY_NO_WEBSITE: 'bg-tone-orange-solid', SOCIAL_ONLY: 'bg-tone-purple-solid', IN_ANALYSIS: 'bg-tone-amber-solid', CONFLICT: 'bg-tone-red-solid',
}

const IN_PROGRESS = new Set(['PENDING', 'PROCESSING', 'WAITING_QUOTA', 'WAITING_RETRY'])
const CHECKED = (s: string | undefined) => !!s && s.startsWith('CHECKED_')

type L = Pick<Lead, 'websiteStatus' | 'investigationState' | 'investigationLastError' | 'enrichError' | 'websiteCoverage'>

// Só o Google consultado (Tavily e Instagram sem consulta concluída) não basta para afirmar "sem site".
function onlyGoogleChecked(l: L): boolean {
  const s = l.websiteCoverage?.sources
  if (!s) return false // legado sem cobertura: segue a decisão armazenada
  return !CHECKED(s.TAVILY) && !CHECKED(s.INSTAGRAM)
}

export function listDecision(l: L): ListDecisionKey {
  const st = l.websiteStatus
  if (st === 'CONFLICT') return 'CONFLICT'
  if (st === 'HAS_WEBSITE') return 'HAS_WEBSITE'
  if (st === 'SOCIAL_ONLY') return 'SOCIAL_ONLY'
  if (st === 'PROBABLY_NO_WEBSITE') {
    const pending = (l.investigationState != null && IN_PROGRESS.has(l.investigationState)) || !!l.investigationLastError || !!l.enrichError
    return pending || onlyGoogleChecked(l) ? 'IN_ANALYSIS' : 'PROBABLY_NO_WEBSITE'
  }
  return 'IN_ANALYSIS' // UNKNOWN, sem decisão, candidato não confirmado, cota pendente, erro/retry
}

// ── Evidências por fonte (gaveta) ────────────────────────────────────────────────────────────
export interface SourceEvidence { source: 'Google Maps' | 'Tavily' | 'Meta/Instagram'; text: string; at: string | null; fromCache: boolean }

type E = Pick<Lead, 'website' | 'siteUrl' | 'statusSite' | 'verificadoEm' | 'instagramHandle' | 'instagramVerificar' | 'websiteCoverage' | 'websiteEvidence'>

function stamp(l: E, source: string): { at: string | null; fromCache: boolean } {
  const items = (l.websiteEvidence ?? []).filter((e) => e.source === source && e.at)
  if (!items.length) return { at: null, fromCache: false }
  const last = items.reduce((a, b) => (new Date(b.at as string) > new Date(a.at as string) ? b : a))
  return { at: last.at as string, fromCache: !!last.fromCache }
}

const NOT_ASKED = (s: string | undefined) => !s || s === 'NOT_CHECKED' || s === 'NOT_CONFIGURED'

export function sourceEvidence(l: E): SourceEvidence[] {
  const s = l.websiteCoverage?.sources ?? {}
  const g = stamp(l, 'GOOGLE')
  const googleUrl = l.website ?? l.siteUrl
  const googleText = googleUrl
    ? `Site informado: ${googleUrl}`
    : l.statusSite === 'sem_site' || CHECKED(s.GOOGLE) ? 'Nenhuma URL de site informada' : 'Não consultado'

  const t = s.TAVILY
  const tavilyText = t === 'CHECKED_NO_RESULT' || t === 'CHECKED_RESULTS_DISCARDED' ? 'Nenhum site próprio encontrado'
    : t === 'CHECKED_WITH_RESULT' ? 'Site candidato encontrado'
    : t === 'CHECKED_CANDIDATES_UNEVALUABLE' ? 'Candidatos encontrados, não deu para avaliar'
    : NOT_ASKED(t) ? 'Não consultado' : 'Não consultado (cota, limite ou erro)'

  const ig = s.INSTAGRAM
  const metaText = l.instagramHandle ? (l.instagramVerificar ? 'Possível perfil' : 'Perfil confirmado')
    : ig === 'CHECKED_NO_RESULT' || ig === 'CHECKED_RESULTS_DISCARDED' ? 'Nenhum perfil encontrado'
    : 'Não consultado'

  const tv = stamp(l, 'TAVILY'); const mt = stamp(l, 'META')
  return [
    { source: 'Google Maps', text: googleText, at: g.at ?? l.verificadoEm, fromCache: g.fromCache },
    { source: 'Tavily', text: tavilyText, at: tv.at, fromCache: tv.fromCache },
    { source: 'Meta/Instagram', text: metaText, at: mt.at, fromCache: mt.fromCache },
  ]
}
