// Variáveis das mensagens de campanha. Escritas como {{nome}} e trocadas pelos dados do estabelecimento no momento do envio.
export const CAMPAIGN_VARIABLES = ['nome', 'contato', 'cidade', 'estado'] as const
export type CampaignVariable = (typeof CAMPAIGN_VARIABLES)[number]

export interface CampaignVars {
  nome: string // nome do estabelecimento
  contato?: string | null // nome da pessoa de contato (cai para o estabelecimento)
  cidade?: string | null
  estado?: string | null
}

const TOKEN = /\{\{\s*([^{}]*?)\s*\}\}/g

/** Variáveis usadas na mensagem que não existem (ex.: {{nmoe}}). */
export function unknownVariables(message: string): string[] {
  const bad = new Set<string>()
  for (const m of message.matchAll(TOKEN)) {
    const key = m[1].toLowerCase()
    if (!(CAMPAIGN_VARIABLES as readonly string[]).includes(key)) bad.add(m[1])
  }
  return [...bad]
}

export function renderCampaignMessage(message: string, vars: CampaignVars): string {
  const values: Record<CampaignVariable, string> = {
    nome: vars.nome.trim(),
    contato: vars.contato?.trim() || vars.nome.trim(),
    cidade: vars.cidade?.trim() || 'sua cidade',
    estado: vars.estado?.trim() || '',
  }
  return message
    .replace(TOKEN, (whole, raw: string) => {
      const key = raw.toLowerCase() as CampaignVariable
      return key in values ? values[key] : whole
    })
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}
