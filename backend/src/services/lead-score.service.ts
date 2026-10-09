import { eligibleForNoWebsite, NO_WEBSITE_MIN_CONFIDENCE, type EligibilityLead } from './no-website-eligibility.service'

// Score de prioridade do lead (maior = mais quente). Pesos ajustáveis aqui.
export const SCORE_WEIGHTS = {
  bonusSemSiteProprio: 4, // decisão PROBABLY_NO_WEBSITE ou SOCIAL_ONLY (nunca status nulo/UNKNOWN/CONFLICT/site fora do ar)
  websiteConfiancaMinima: 0.6, // HAS_WEBSITE abaixo disso não derruba o score
  bonusInstagramSemSite: 3, // tem Instagram mas não tem site próprio funcionando
  penalidadeSiteOk: 6, // site próprio funcionando
  bonusCelular: 3, // celular = provável dono no WhatsApp
  penalidadeFixo: 4, // fixo: dono raramente atende WhatsApp nesse número
  bonusAvaliacoesIdeais: 3, // faixa de 50 a 400 avaliações: negócio ativo, mas ainda tocado pelo dono
  penalidadeAvaliacoesAltas: 3, // acima de 800: hotel grande, decisão mais lenta
  penalidadeSemTelefoneComInstagram: 5, // sem telefone mas com Instagram confirmado: ainda dá pra abordar por lá
  penalidadeSemTelefone: 1000, // sem telefone não serve pra campanha de WhatsApp: vai pro fim
}

export const AVALIACOES_IDEAL = { min: 50, max: 400 }
export const AVALIACOES_ALTAS = 800

export interface ScoreInput {
  avaliacao: number | null
  numAvaliacoes: number | null
  statusSite: string
  siteStatus: string | null
  whatsapp: string | null
  instagram: string | null
  instagramHandle: string | null
  foundWebsite: string | null
  foundSiteStatus: string | null
  instagramVerificar?: boolean // sugestão não confirmada não conta no score
  foundWebsiteVerificar?: boolean
  phoneMobile?: boolean | null // true celular, false fixo, null/undefined desconhecido
  ownerGroupSize?: number // só informativo: mesmo telefone = contato compartilhado, não entra no score
  // Decisão em camadas (null = ainda não classificado: neutro no score, sem bônus nem penalidade de site).
  websiteStatus?: string | null
  websiteConfidence?: number | null
  confirmedWebsite?: string | null
}

// Três eixos separados (nenhum substitui o outro):
//  - POTENCIAL COMERCIAL (computeLeadScore → Prospect.leadScore): quão bom é o negócio como cliente, dado o que sabemos do site;
//  - CONFIANÇA DA CLASSIFICAÇÃO (classificationConfidence → websiteConfidence): heurística, não calibrada;
//  - PRIORIDADE DE INVESTIGAÇÃO (investigationPriority): quem gastar orçamento primeiro. Não mede "sem site".
// Regras: sem decisão (null), UNKNOWN e CONFLICT NÃO recebem bônus de "sem site"; site fora do ar não é ausência de site;
// mesmo celular em mais de um negócio é contato compartilhado — não prova mesmo dono, então não rende bônus.
const SEM_SITE = new Set(['PROBABLY_NO_WEBSITE', 'SOCIAL_ONLY'])

// Site confirmado e funcionando (HAS_WEBSITE com confiança suficiente e no ar).
function hasWorkingConfirmedSite(l: ScoreInput): boolean {
  if (l.websiteStatus !== 'HAS_WEBSITE' || (l.websiteConfidence ?? 0) < SCORE_WEIGHTS.websiteConfiancaMinima) return false
  const down = (v: string | null) => v === 'fora_do_ar' || v === 'dominio_parado'
  return !(down(l.siteStatus) || (!!l.confirmedWebsite && l.confirmedWebsite === l.foundWebsite && down(l.foundSiteStatus)))
}

export function computeLeadScore(l: ScoreInput): number {
  const W = SCORE_WEIGHTS
  let score = Math.log((l.numAvaliacoes ?? 0) + 1) * (l.avaliacao ?? 0)
  if (l.websiteStatus && SEM_SITE.has(l.websiteStatus)) {
    score += W.bonusSemSiteProprio
    if ((l.instagramHandle && !l.instagramVerificar) || l.instagram) score += W.bonusInstagramSemSite
  } else if (hasWorkingConfirmedSite(l)) {
    score -= W.penalidadeSiteOk
  } // null / UNKNOWN / CONFLICT / site confirmado fora do ar: neutro — sem bônus nem penalidade
  const n = l.numAvaliacoes ?? 0
  if (n >= AVALIACOES_IDEAL.min && n <= AVALIACOES_IDEAL.max) score += W.bonusAvaliacoesIdeais
  else if (n > AVALIACOES_ALTAS) score -= W.penalidadeAvaliacoesAltas
  if (l.phoneMobile === true) score += W.bonusCelular
  else if (l.phoneMobile === false) score -= W.penalidadeFixo
  if (!l.whatsapp || l.whatsapp.replace(/\D/g, '').length < 8) {
    // Penalidade máxima só sem telefone E sem Instagram confirmado.
    const instagramConfirmado = (!!l.instagramHandle && !l.instagramVerificar) || !!l.instagram
    score -= instagramConfirmado ? W.penalidadeSemTelefoneComInstagram : W.penalidadeSemTelefone
  }
  return Math.round(score * 100) / 100
}

export function classificationConfidence(l: Pick<ScoreInput, 'websiteStatus' | 'websiteConfidence'>): number {
  return l.websiteStatus ? Math.round((l.websiteConfidence ?? 0) * 100) / 100 : 0
}

// Quem investigar primeiro quando o orçamento é curto: telefone (celular pesa mais), volume/qualidade de avaliações e Instagram.
export function investigationPriority(l: { phoneMobile?: boolean | null; whatsapp?: string | null; numAvaliacoes?: number | null; avaliacao?: number | null; instagramHandle?: string | null }): number {
  const phone = l.phoneMobile ? 3 : l.whatsapp ? 1 : 0
  return Math.round((phone + Math.log((l.numAvaliacoes ?? 0) + 1) * ((l.avaliacao ?? 0) / 5) + (l.instagramHandle ? 1 : 0)) * 100) / 100
}

// Pode entrar em campanha destinada a quem NÃO tem site? Regra única em no-website-eligibility.service (evidência vigente,
// cobertura completa, sem candidato pendente, versão aceita). Reexportada aqui para os pontos de uso existentes.
export const CAMPANHA_SEM_SITE_CONFIANCA_MIN = NO_WEBSITE_MIN_CONFIDENCE
export const eligibleForNoWebsiteCampaign = (l: EligibilityLead, now?: Date): boolean => eligibleForNoWebsite(l, now)
