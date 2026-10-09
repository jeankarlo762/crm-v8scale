import { z } from 'zod'

import { STATUS_SITE_LEGADO } from '../services/status-site-legacy.service'

export const STATUS_SITE = ['sem_site', 'so_instagram', 'so_facebook', 'link_bio', 'so_ota', 'site_proprio', 'fora_do_ar', 'sem_https', 'certificado_invalido', 'verificar'] as const
// Ordem = ordem de exibição. A cadência da campanha avança nao_contatado -> contato_1 -> contato_2 ->
// contato_3 -> sem_retorno; negociando/fechado/recusado são marcados à mão.
export const STATUS_CONTATO = [
  'nao_contatado', 'contato_1', 'contato_2', 'contato_3', 'sem_retorno', 'negociando', 'fechado', 'recusado',
] as const

// Responsável fixo por enquanto (sem tabela de usuários); 'nenhum' só existe como filtro.
// Responsável pelo prospect: id de um User do CRM (validado na rota). 'nenhum' no filtro = sem responsável.
export const responsavelId = z.string().trim().min(1).max(64)

export const createNichoSchema = z.object({
  nome: z.string().trim().min(1, 'Nome do nicho obrigatório').max(80),
  termosBusca: z.array(z.string().trim().min(1).max(80)).max(15).optional(),
})

export const updateNichoTermosSchema = z.object({
  termosBusca: z.array(z.string().trim().min(1).max(80)).max(15),
})

export const buscarLeadsSchema = z.object({
  nichoId: z.string().min(1, 'Nicho obrigatório'),
  cidades: z.string().trim().min(1, 'Informe ao menos uma cidade').max(300),
})

// Aceita um ou vários status separados por vírgula (?statusSite=sem_site,so_redes).
const statusSiteFilterSchema = z
  .string()
  .optional()
  .transform((v) => (v ? v.split(',') : undefined))
  .refine((v) => !v || v.every((s) => (STATUS_SITE as readonly string[]).includes(s) || (STATUS_SITE_LEGADO as readonly string[]).includes(s)), 'statusSite inválido')

const csv = (allowed: readonly string[], msg: string) => z.string().optional().transform((v) => (v ? v.split(',') : undefined)).refine((v) => !v || v.every((x) => allowed.includes(x)), msg)
export const DECISOES = ['HAS_WEBSITE', 'PROBABLY_NO_WEBSITE', 'SOCIAL_ONLY', 'UNKNOWN', 'CONFLICT', 'SEM_DECISAO'] as const
export const ANDAMENTOS = ['PENDING', 'PROCESSING', 'WAITING_QUOTA', 'WAITING_RETRY', 'DONE', 'MANUAL_REVIEW', 'LEGADO'] as const

export const listLeadsQuerySchema = z.object({
  nichoId: z.string().min(1, 'nichoId obrigatório'),
  statusSite: statusSiteFilterSchema,
  status: z.enum(STATUS_CONTATO).optional(),
  cidade: z.string().trim().min(1).optional(),
  estado: z.string().trim().length(2).transform((v) => v.toUpperCase()).optional(),
  responsavel: responsavelId.optional(),
  // Filtros de avaliação do Google: nota mínima e faixa de nº de avaliações.
  avaliacaoMin: z.coerce.number().min(0).max(5).optional(),
  numAvaliacoesMin: z.coerce.number().int().min(0).optional(),
  numAvaliacoesMax: z.coerce.number().int().min(0).optional(),
  somenteCelular: z.enum(['true', 'false']).optional().transform((v) => v === 'true' || undefined),
  decisao: csv(DECISOES, 'decisao inválida'),
  andamento: csv(ANDAMENTOS, 'andamento inválido'),
  somenteLiberados: z.enum(['true', 'false']).optional().transform((v) => v === 'true' || undefined),
})

export const enriquecerSchema = z.object({
  nichoId: z.string().min(1, 'Nicho obrigatório'),
  limite: z.number().int().min(1).max(200).optional(), // máx. de leads enviados ao Place Details (Enterprise) neste clique
  ids: z.array(z.string().min(1)).max(200).optional(), // só estes leads (seleção manual)
})

export const deleteLeadsSchema = z.object({
  ids: z.array(z.string().min(1)).min(1, 'Selecione ao menos um lead').max(5000),
})

export const listCidadesQuerySchema = z.object({
  nichoId: z.string().min(1).optional(),
  estado: z.string().trim().length(2).transform((v) => v.toUpperCase()).optional(),
})

export const exportLeadsQuerySchema = listLeadsQuerySchema.extend({
  format: z.enum(['csv', 'xlsx']),
})

export const buscasRecentesQuerySchema = z.object({
  nichoId: z.string().min(1, 'Nicho obrigatório'),
  cidades: z.string().trim().min(1).max(300),
})

// Edição parcial de um lead: status de contato, anotação e responsável.
export const updateLeadSchema = z
  .object({
    status: z.enum(STATUS_CONTATO),
    notes: z.string().max(2000).nullable(),
    responsavel: responsavelId.nullable(),
    foundWebsite: z.string().trim().max(300).nullable(), // vazio/null volta pro automático
    instagramHandle: z.string().trim().max(300).nullable(),
  })
  .partial()
  .refine((d) => Object.keys(d).length > 0, 'Nada pra atualizar')

export const bulkResponsavelSchema = z.object({
  ids: z.array(z.string().min(1)).min(1, 'Selecione ao menos um lead').max(5000),
  responsavel: responsavelId.nullable(),
})

export const bulkStatusSchema = z.object({
  ids: z.array(z.string().min(1)).min(1, 'Selecione ao menos um lead').max(5000),
  status: z.enum(STATUS_CONTATO),
})

// Linha vinda da prévia de importação de planilha (.csv/.xlsx) — o usuário
// ainda pode editar antes de confirmar; só nome e WhatsApp são obrigatórios.
const importRowSchema = z.object({
  arenaName: z.string().min(1, 'Nome obrigatório').max(200),
  state: z.string().max(2).nullable().optional(),
  city: z.string().max(120).nullable().optional(),
  address: z.string().max(300).nullable().optional(),
  contactName: z.string().max(120).nullable().optional(),
  whatsapp: z.string().min(1, 'WhatsApp obrigatório').max(30),
  instagram: z.string().max(120).nullable().optional(),
  website: z.string().max(300).nullable().optional(),
  googleMapsUrl: z.string().max(500).nullable().optional(),
  sports: z.string().max(300).nullable().optional(),
  courtsInfo: z.string().max(300).nullable().optional(),
  currentSystem: z.string().max(120).nullable().optional(),
})

export const importLeadsSchema = z.object({
  nichoId: z.string().min(1, 'Nicho obrigatório'),
  rows: z.array(importRowSchema).min(1, 'Nenhuma linha pra importar').max(5000),
})

export type ImportLeadsInput = z.infer<typeof importLeadsSchema>
