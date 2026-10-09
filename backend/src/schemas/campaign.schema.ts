import { z } from 'zod'
import { STATUS_CONTATO } from './lead.schema'
import { unknownVariables, CAMPAIGN_VARIABLES } from '../utils/campaign-variables'

export const createCampaignSchema = z.object({
  name: z.string().min(1, 'Nome obrigatório').max(120),
  // Usuário responsável (obrigatório: alinha a campanha ao funil).
  responsavelId: z.string().trim().min(1, 'Informe o responsável').max(64),
  // Variações da mensagem (ex.: "Oi", "Opa", "Olá") — cada destinatário
  // recebe uma escolhida ao acaso.
  // Aceita variáveis {{nome}}, {{contato}}, {{cidade}} e {{estado}}, preenchidas com os dados do estabelecimento no envio.
  messages: z.array(
    z.string().min(1, 'Mensagem vazia').max(1000).refine(
      (m) => unknownVariables(m).length === 0,
      (m) => ({ message: `Variável desconhecida: ${unknownVariables(m).map((v) => `{{${v}}}`).join(', ')}. Use ${CAMPAIGN_VARIABLES.map((v) => `{{${v}}}`).join(', ')}` }),
    ),
  ).min(1, 'Informe ao menos uma mensagem').max(20),
  // Seleção individual (vinda da Prospecção): quando informada, só esses leads entram — status/nicho/estado/cidade/limite são ignorados.
  prospectIds: z.array(z.string().trim().min(1).max(64)).min(1).max(5000).optional(),
  targetStatus: z.enum(STATUS_CONTATO),
  // Opcional: restringe os destinatários a um nicho; sem valor = todos os nichos.
  nichoId: z.string().min(1).nullish(),
  // Opcional: restringe os destinatários a um estado (UF); sem valor = todos os estados.
  estado: z.string().trim().length(2).transform((v) => v.toUpperCase()).nullish(),
  // Opcional: restringe os destinatários a uma cidade; sem valor = todas as cidades.
  cidade: z.string().trim().min(1).nullish(),
  // Público: 'sem_site' só leva leads com decisão PROBABLY_NO_WEBSITE/SOCIAL_ONLY e confiança mínima — UNKNOWN, CONFLICT
  // e leads sem decisão NUNCA entram automaticamente.
  publico: z.enum(['todos', 'sem_site']).default('todos'),
  // Máximo de envios da campanha (0 a 5000); 0 = sem limite.
  limite: z.number().int().min(0, 'Mínimo 0').max(5000, 'Máximo 5000').default(0),
  // Intervalo fixo entre um envio e o próximo.
  delaySec: z.number().int().min(1, 'Mínimo de 1 segundo').max(3600).default(5),
})

// Edição aceita os mesmos campos da criação.
export const updateCampaignSchema = createCampaignSchema

export type UpdateCampaignInput = z.infer<typeof updateCampaignSchema>
export type CreateCampaignInput = z.infer<typeof createCampaignSchema>

// Revisão explícita do público de uma campanha anterior ao controle de público.
export const reviewAudienceSchema = z.object({ publico: z.enum(['todos', 'sem_site']) })
