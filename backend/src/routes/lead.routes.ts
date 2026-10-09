import { backfillProspectStates } from '../services/geo-uf.service'
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import multipart from '@fastify/multipart'
import ExcelJS from 'exceljs'
import { parse as parseCsv } from 'csv-parse/sync'
import { authenticate, requireRole } from '../middlewares/auth'

// Prospecção e campanhas: gerentes e administradores (vendedor não acessa).
const requireSuperAdmin = requireRole('ADMIN', 'MANAGER')
import * as leadService from '../services/lead.service'
import { assertActiveUser } from '../utils/validation'
import {
  createNichoSchema, updateNichoTermosSchema, buscarLeadsSchema, listLeadsQuerySchema, updateLeadSchema, importLeadsSchema, exportLeadsQuerySchema, listCidadesQuerySchema, deleteLeadsSchema,
  bulkStatusSchema, bulkResponsavelSchema, buscasRecentesQuerySchema, enriquecerSchema,
} from '../schemas/lead.schema'

const MAX_IMPORT_ROWS = 5000

type LeadField =
  | 'arenaName' | 'state' | 'city' | 'address' | 'contactName' | 'whatsapp'
  | 'instagram' | 'website' | 'googleMapsUrl' | 'sports' | 'courtsInfo' | 'currentSystem'

// Alias de cabeçalho (case-insensitive) — planilhas de prospecção variam
// muito no nome das colunas. Mesmo padrão de pipeline.routes.ts.
const HEADER_ALIASES: Record<string, LeadField> = {
  'nome da arena': 'arenaName', arena: 'arenaName', nome: 'arenaName',
  estado: 'state', uf: 'state',
  cidade: 'city',
  endereço: 'address', endereco: 'address',
  contato: 'contactName', 'nome do contato': 'contactName', responsável: 'contactName', responsavel: 'contactName',
  whatsapp: 'whatsapp', telefone: 'whatsapp', celular: 'whatsapp', fone: 'whatsapp',
  instagram: 'instagram',
  site: 'website', website: 'website',
  'google maps': 'googleMapsUrl', maps: 'googleMapsUrl', 'link do maps': 'googleMapsUrl',
  esportes: 'sports', modalidades: 'sports',
  quadras: 'courtsInfo', 'info quadras': 'courtsInfo', 'informações das quadras': 'courtsInfo',
  'sistema atual': 'currentSystem', sistema: 'currentSystem',
}

interface ParsedLeadRow {
  arenaName: string
  state: string | null
  city: string | null
  address: string | null
  contactName: string | null
  whatsapp: string
  instagram: string | null
  website: string | null
  googleMapsUrl: string | null
  sports: string | null
  courtsInfo: string | null
  currentSystem: string | null
  warnings: string[]
}

function rowsFromAoa(aoa: unknown[][]): { rows: ParsedLeadRow[]; totalRows: number; truncated: boolean } {
  if (aoa.length === 0) return { rows: [], totalRows: 0, truncated: false }
  const [headerRow, ...dataRows] = aoa
  const columns = headerRow.map((h) => {
    const key = String(h ?? '').trim().toLowerCase()
    return HEADER_ALIASES[key]
  })

  const nonEmptyRows = dataRows.filter((row) => row.some((cell) => String(cell ?? '').trim() !== ''))

  const rows = nonEmptyRows.slice(0, MAX_IMPORT_ROWS).map((row) => {
    const rec: Partial<Record<LeadField, string>> = {}
    columns.forEach((field, idx) => {
      if (!field) return
      const raw = String(row[idx] ?? '').trim()
      if (raw) rec[field] = raw
    })

    const warnings: string[] = []
    if (!rec.arenaName) warnings.push('Nome da arena não encontrado')
    if (!rec.whatsapp) warnings.push('WhatsApp não encontrado')

    return {
      arenaName: rec.arenaName ?? '',
      state: rec.state ?? null,
      city: rec.city ?? null,
      address: rec.address ?? null,
      contactName: rec.contactName ?? null,
      whatsapp: rec.whatsapp ?? '',
      instagram: rec.instagram ?? null,
      website: rec.website ?? null,
      googleMapsUrl: rec.googleMapsUrl ?? null,
      sports: rec.sports ?? null,
      courtsInfo: rec.courtsInfo ?? null,
      currentSystem: rec.currentSystem ?? null,
      warnings,
    }
  })

  return { rows, totalRows: nonEmptyRows.length, truncated: nonEmptyRows.length > MAX_IMPORT_ROWS }
}

export async function nichoRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate)
  app.addHook('preHandler', requireSuperAdmin)

  app.get('/', async (_req: FastifyRequest, reply: FastifyReply) => {
    return reply.send(await leadService.listNichos())
  })

  app.post('/', async (req: FastifyRequest, reply: FastifyReply) => {
    const { nome, termosBusca } = createNichoSchema.parse(req.body)
    return reply.status(201).send(await leadService.createNicho(nome, termosBusca))
  })

  // Aliases de busca do nicho (ex.: "quadra de beach tennis" para "arenas esportivas").
  app.put<{ Params: { id: string } }>('/:id/termos', async (req, reply: FastifyReply) => {
    const { termosBusca } = updateNichoTermosSchema.parse(req.body)
    return reply.send(await leadService.updateNichoTermos(req.params.id, termosBusca))
  })

  app.delete<{ Params: { id: string } }>('/:id', async (req, reply: FastifyReply) => {
    await leadService.deleteNicho(req.params.id)
    return reply.status(204).send()
  })
}

export async function leadRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate)
  app.addHook('preHandler', requireSuperAdmin)

  await app.register(multipart, { limits: { fileSize: 8 * 1024 * 1024 } })

  app.get('/', async (req: FastifyRequest, reply: FastifyReply) => {
    const filters = listLeadsQuerySchema.parse(req.query)
    return reply.send(await leadService.listLeads(filters))
  })

  // Exclui vários leads de uma vez (seleção na tabela).
  app.post('/delete-many', async (req: FastifyRequest, reply: FastifyReply) => {
    const { ids } = deleteLeadsSchema.parse(req.body)
    return reply.send(await leadService.deleteLeads(ids))
  })

  // Cidades que têm lead — de um nicho (?nichoId=) ou de todos.
  app.get('/cidades', async (req: FastifyRequest, reply: FastifyReply) => {
    const { nichoId, estado } = listCidadesQuerySchema.parse(req.query)
    return reply.send(await leadService.listCidades(nichoId, estado))
  })

  // Estados (UF) que têm lead — de um nicho (?nichoId=) ou de todos.
  app.get('/estados', async (req: FastifyRequest, reply: FastifyReply) => {
    const { nichoId } = listCidadesQuerySchema.parse(req.query)
    return reply.send(await leadService.listEstados(nichoId))
  })

  // Baixa os leads de uma aba (com os filtros da tela) em CSV ou XLSX.
  app.get('/export', async (req: FastifyRequest, reply: FastifyReply) => {
    const { format, ...filters } = exportLeadsQuerySchema.parse(req.query)
    const file = await leadService.exportLeads(filters, format)
    return reply
      .header('Content-Type', file.contentType)
      .header('Content-Disposition', `attachment; filename="${file.filename}"`)
      .send(file.body)
  })

  app.post('/buscar', async (req: FastifyRequest, reply: FastifyReply) => {
    const { nichoId, cidades } = buscarLeadsSchema.parse(req.body)
    return reply.send(await leadService.buscarLeads(nichoId, cidades))
  })

  // Contador de buscas do mês (só chamadas reais à Places API).
  app.get('/quota', async (_req: FastifyRequest, reply: FastifyReply) => {
    return reply.send(await leadService.getQuota())
  })

  // Consumo das APIs externas vs. orçamento interno (Google/Tavily/Meta) + chamadas poupadas.
  // Preenche a UF dos prospects que estão sem ela (endereço do Google / tabela do IBGE pela cidade).
  app.post('/preencher-estados', async (_req: FastifyRequest, reply: FastifyReply) => {
    return reply.send(await backfillProspectStates())
  })

  app.get('/consumo', async (_req: FastifyRequest, reply: FastifyReply) => {
    return reply.send(await leadService.getConsumo())
  })

  // Contadores: decisão (HAS_WEBSITE...) e andamento (aguardando cota, revisão manual...) são eixos separados.
  app.get('/resumo', async (req: FastifyRequest, reply: FastifyReply) => {
    const { nichoId } = listCidadesQuerySchema.parse(req.query)
    return reply.send(await leadService.getResumoInvestigacao(nichoId))
  })

  // Credencial corrigida: retoma a integração pausada (auth inválida) e acorda os leads que esperavam.
  app.post<{ Params: { provider: string } }>('/integracoes/:provider/retomar', async (req, reply: FastifyReply) => {
    return reply.send(await leadService.retomarIntegracao(req.params.provider))
  })

  // Buscas nicho+cidade dos últimos 7 dias — o frontend usa pra avisar antes de repetir.
  app.get('/buscas-recentes', async (req: FastifyRequest, reply: FastifyReply) => {
    const { nichoId, cidades } = buscasRecentesQuerySchema.parse(req.query)
    return reply.send(await leadService.buscasRecentes(nichoId, cidades))
  })

  // Aplica status ou responsável a vários leads de uma vez (seleção na tabela).
  app.patch('/bulk-status', async (req: FastifyRequest, reply: FastifyReply) => {
    const { ids, status } = bulkStatusSchema.parse(req.body)
    return reply.send(await leadService.bulkUpdateStatus(ids, status, req.user.id))
  })

  app.patch('/bulk-responsavel', async (req: FastifyRequest, reply: FastifyReply) => {
    const { ids, responsavel } = bulkResponsavelSchema.parse(req.body)
    if (responsavel) await assertActiveUser(responsavel)
    return reply.send(await leadService.bulkUpdateResponsavel(ids, responsavel))
  })

  // Edita um lead: status de contato, notas e/ou responsável (só o que vier no body).
  app.patch<{ Params: { id: string } }>('/:id', async (req, reply: FastifyReply) => {
    const data = updateLeadSchema.parse(req.body)
    if (data.responsavel) await assertActiveUser(data.responsavel)
    return reply.send(await leadService.updateLead(req.params.id, data, req.user.id))
  })

  // Força reclassificação da presença digital do lead (ignora cache de 30 dias).
  // Prospect vira lead do funil comercial (uma vez só; repetir devolve o lead já criado).
  app.post<{ Params: { id: string } }>('/:id/convert', async (req, reply: FastifyReply) => {
    const result = await leadService.convertToLead(req.params.id, req.user.id)
    return reply.status(result.created ? 201 : 200).send(result)
  })

  app.post<{ Params: { id: string } }>('/:id/reverificar', async (req, reply: FastifyReply) => {
    await leadService.reverificarLead(req.params.id)
    return reply.status(202).send({ enfileirado: true })
  })

  // Botão "Enriquecer" da aba: busca web (Tavily) + health check + score em background.
  app.post('/enriquecer', async (req: FastifyRequest, reply: FastifyReply) => {
    const { nichoId, limite, ids } = enriquecerSchema.parse(req.body)
    return reply.status(202).send(await leadService.enriquecerNicho(nichoId, { limite, ids }))
  })

  // Parse de planilha (.csv/.xlsx) pra prévia — nada é persistido aqui.
  app.post('/import-preview', async (req: FastifyRequest, reply: FastifyReply) => {
    const file = await req.file()
    if (!file) {
      return reply.status(400).send({ error: true, message: 'Nenhum arquivo enviado', code: 'BAD_REQUEST' })
    }
    const buffer = await file.toBuffer()
    const isCsv = /\.csv$/i.test(file.filename) || file.mimetype === 'text/csv'

    let aoa: unknown[][] = []
    try {
      if (isCsv) {
        aoa = parseCsv(buffer, { skip_empty_lines: true, bom: true }) as unknown[][]
      } else {
        const workbook = new ExcelJS.Workbook()
        await workbook.xlsx.load(buffer as unknown as ArrayBuffer)
        const sheet = workbook.worksheets[0]
        if (!sheet) {
          return reply.status(400).send({ error: true, message: 'Planilha vazia', code: 'BAD_REQUEST' })
        }
        sheet.eachRow((row) => {
          // ExcelJS row.values is 1-indexed with a leading empty slot.
          aoa.push((row.values as unknown[]).slice(1).map((v) => (v && typeof v === 'object' && 'text' in (v as object) ? (v as { text: string }).text : v)))
        })
      }
    } catch {
      return reply.status(400).send({ error: true, message: 'Arquivo inválido — envie um .csv ou .xlsx', code: 'BAD_REQUEST' })
    }

    return reply.send(rowsFromAoa(aoa))
  })

  // Confirma a importação: cria os leads da aba a partir das linhas já
  // revisadas pelo usuário na prévia — pula duplicados por WhatsApp.
  app.post('/import', async (req: FastifyRequest, reply: FastifyReply) => {
    const input = importLeadsSchema.parse(req.body)
    return reply.send(await leadService.importLeads(input))
  })
}
