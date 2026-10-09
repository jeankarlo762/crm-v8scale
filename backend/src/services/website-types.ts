// Tipos compartilhados da investigação "este lead tem site?". Três eixos independentes:
//  1) decisão (WebsiteStatus): o que sabemos sobre o site;
//  2) andamento (InvestigationState): em que ponto a investigação está (nunca é evidência de nada);
//  3) estado de cada fonte (SourceState): o que aconteceu quando consultamos.

export type WebsiteStatus = 'HAS_WEBSITE' | 'PROBABLY_NO_WEBSITE' | 'SOCIAL_ONLY' | 'UNKNOWN' | 'CONFLICT'
export const WEBSITE_STATUSES: WebsiteStatus[] = ['HAS_WEBSITE', 'PROBABLY_NO_WEBSITE', 'SOCIAL_ONLY', 'UNKNOWN', 'CONFLICT']

export type InvestigationState = 'PENDING' | 'PROCESSING' | 'WAITING_QUOTA' | 'WAITING_RETRY' | 'DONE' | 'MANUAL_REVIEW'
export const INVESTIGATION_STATES: InvestigationState[] = ['PENDING', 'PROCESSING', 'WAITING_QUOTA', 'WAITING_RETRY', 'DONE', 'MANUAL_REVIEW']

export type NextAction =
  | 'GOOGLE_DETAILS' | 'PAGE_CHECK' | 'LINK_RESOLVE' | 'META_BIO' | 'TAVILY_NAME' | 'TAVILY_PHONE' | 'TAVILY_HANDLE' | 'TAVILY_ADDRESS' | 'TAVILY_INSTAGRAM' | 'RECOMPUTE' | 'MANUAL_REVIEW'

// Estado de uma fonte numa investigação. Só os dois primeiros "CHECKED_*" negativos valem como ausência de resultado:
//  CHECKED_NO_RESULT                  consulta OK, a resposta veio VAZIA
//  CHECKED_RESULTS_DISCARDED          consulta OK, havia resultados, todos descartados por regra objetiva (diretório, outro estado...)
//  CHECKED_CANDIDATES_UNEVALUABLE     consulta OK, havia candidatos que NÃO deu pra avaliar (403, JS, erro) → NÃO é negativo
//  NOT_CHECKED_QUOTA / RATE_LIMITED / API_ERROR / AUTH_PAUSED / NOT_CONFIGURED   a fonte não respondeu → NÃO é negativo
export type SourceState =
  | 'CHECKED_WITH_RESULT' | 'CHECKED_NO_RESULT' | 'CHECKED_RESULTS_DISCARDED' | 'CHECKED_CANDIDATES_UNEVALUABLE'
  | 'NOT_CHECKED' | 'NOT_CHECKED_QUOTA' | 'RATE_LIMITED' | 'API_ERROR' | 'AUTH_PAUSED' | 'NOT_CONFIGURED'

export const NEGATIVE_VALID_STATES: SourceState[] = ['CHECKED_NO_RESULT', 'CHECKED_RESULTS_DISCARDED']
export const isNegativeValid = (s: SourceState | undefined | null): boolean => !!s && NEGATIVE_VALID_STATES.includes(s)

export interface Evidence {
  source: string // GOOGLE | TAVILY | META | WEBSITE | MANUAL | DECISION
  type: string
  value: string | null
  confidence: number // peso heurístico do sinal (negativo = penalidade). NÃO é probabilidade calibrada.
  at?: string // ISO: quando foi realmente coletada
  fromCache?: boolean // reaproveitada: não é coleta nova
}

// Versões de COLETA do Google aceitas como evidência do campo websiteUri (FieldMask pediu places.websiteUri, SKU Enterprise).
// Mude ao alterar FIELD_MASK/SKU: evidência de versão não listada fica INVÁLIDA (a etapa GOOGLE volta a ficar pendente).
export const GOOGLE_COLLECTION_VERSION = 'text-search-enterprise:v1'
export const GOOGLE_DETAILS_COLLECTION_VERSION = 'place-details-enterprise:v1'
export const GOOGLE_COLLECTION_VERSIONS = [GOOGLE_COLLECTION_VERSION, GOOGLE_DETAILS_COLLECTION_VERSION]

// Versão do classificador: muda quando regras de identidade/decisão mudam e invalida fatos extraídos antigos.
export const CLASSIFIER_VERSION = '2026-10-01.1'
