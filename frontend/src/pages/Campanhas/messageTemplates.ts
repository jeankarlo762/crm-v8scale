// Gerador de variações de mensagem para campanhas de WhatsApp, a partir da necessidade do cliente.
// Cada objetivo gera 3 variações com tom diferente. {{nome}} é trocado pelo nome do estabelecimento no envio.

export type CampaignObjective = 'landing_page' | 'site' | 'pagina_google'

export const OBJECTIVE_OPTIONS: { value: CampaignObjective; label: string; hint: string }[] = [
  { value: 'landing_page', label: 'Landing page', hint: 'Página única para captar reservas, aulas ou contatos' },
  { value: 'site', label: 'Site', hint: 'Site profissional para quem ainda não tem um' },
  { value: 'pagina_google', label: 'Página no Google', hint: 'Perfil no Google Maps/Meu Negócio para ser encontrado' },
]

export const VARIABLE_OPTIONS: { key: string; label: string; example: string }[] = [
  { key: 'nome', label: 'Nome do estabelecimento', example: 'Concessionária Via Sul' },
  { key: 'contato', label: 'Nome do contato', example: 'Carlos' },
  { key: 'cidade', label: 'Cidade', example: 'Curitiba' },
  { key: 'estado', label: 'Estado (UF)', example: 'PR' },
]

const TEMPLATES: Record<CampaignObjective, [string, string, string]> = {
  landing_page: [
    'Oi, tudo bem? Aqui é da V8 Scale. Vi a {{nome}} em {{cidade}} e achei que uma landing page com seus veículos em destaque, ofertas e botão direto pro WhatsApp podia trazer mais leads qualificados. Posso te mostrar um exemplo rápido?',
    'Olá! Sou da V8 Scale e crio páginas de captação para concessionárias como a {{nome}}. É uma página simples, rápida e feita para o comprador te chamar no WhatsApp em um toque. Quer ver como ficaria a da {{nome}}?',
    'Opa, tudo certo? A V8 Scale faz landing pages que transformam quem procura carro em {{cidade}} em visita na loja. Posso te enviar um modelo sem compromisso?',
  ],
  site: [
    'Oi, tudo bem? Aqui é da V8 Scale. Procurei a {{nome}} na internet e não encontrei um site seu. Hoje quase todo comprador pesquisa online antes de visitar a loja. Posso te mostrar como um site com o estoque ajudaria a {{nome}} a receber mais clientes?',
    'Olá! Sou da V8 Scale. Criamos sites e campanhas de tráfego pago para concessionárias de {{cidade}} que querem vender mais carros com previsibilidade. Faz sentido conversar sobre a {{nome}}?',
    'Opa, tudo bem? Notei que a {{nome}} ainda não tem site próprio. A gente cuida de tudo: site, anúncios e geração de leads, sem dor de cabeça. Quer que eu te explique como funciona?',
  ],
  pagina_google: [
    'Oi, tudo bem? Aqui é da V8 Scale. Vi a {{nome}} no Google e dá para melhorar bastante a sua página: fotos do estoque, horários, descrição e avaliações bem cuidadas fazem mais gente te escolher. Posso te mostrar o que ajustaria?',
    'Olá! Sou da V8 Scale e cuido de perfis no Google e anúncios para concessionárias de {{cidade}}. Um perfil completo coloca a {{nome}} na frente de quem procura carro perto e traz mais ligações e visitas. Quer uma análise gratuita?',
    'Opa, tudo certo? Quando alguém busca por perto, o Google mostra primeiro os perfis mais completos. Posso dar uma olhada na página do {{nome}} e te dizer o que falta para aparecer melhor?',
  ],
}

/** Três variações para o objetivo escolhido. `detalhe` (opcional) é uma observação sua, adicionada ao final de cada uma. */
export function generateVariations(objective: CampaignObjective, detalhe?: string): string[] {
  const extra = detalhe?.trim().replace(/\s+/g, ' ')
  const suffix = extra ? ` ${extra.charAt(0).toUpperCase()}${extra.slice(1)}${/[.!?]$/.test(extra) ? '' : '.'}` : ''
  return TEMPLATES[objective].map((t) => `${t}${suffix}`.slice(0, 1000))
}

/** Pré-visualização com dados de exemplo. */
export function previewMessage(message: string): string {
  const values = Object.fromEntries(VARIABLE_OPTIONS.map((v) => [v.key, v.example]))
  return message.replace(/\{\{\s*([^{}]*?)\s*\}\}/g, (whole, raw: string) => values[raw.toLowerCase()] ?? whole)
}

export function unknownVariables(message: string): string[] {
  const known = new Set(VARIABLE_OPTIONS.map((v) => v.key))
  return [...message.matchAll(/\{\{\s*([^{}]*?)\s*\}\}/g)].map((m) => m[1]).filter((k) => !known.has(k.toLowerCase()))
}
