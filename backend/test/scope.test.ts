import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../src/app'
import { prisma } from '../src/config/database'
import { HAS_DB, bearer, createUser, login, resetDb, stageByKind } from './helpers'

describe.skipIf(!HAS_DB)('escopo por perfil (comercial)', () => {
  let app: FastifyInstance
  let adminTok: string
  let managerTok: string
  let sellerTok: string
  let otherSellerTok: string
  let sellerId: string
  let otherSellerId: string

  beforeAll(async () => {
    app = buildApp()
    await app.ready()
  })
  afterAll(async () => {
    await app.close()
    await prisma.$disconnect()
  })

  beforeEach(async () => {
    await resetDb()
    const admin = await createUser('ADMIN')
    const manager = await createUser('MANAGER')
    const seller = await createUser('SELLER', 'seller1@test.local')
    const other = await createUser('SELLER', 'seller2@test.local')
    sellerId = seller.id
    otherSellerId = other.id
    adminTok = (await login(app, admin.email)).body.accessToken
    managerTok = (await login(app, manager.email)).body.accessToken
    sellerTok = (await login(app, seller.email)).body.accessToken
    otherSellerTok = (await login(app, other.email)).body.accessToken
  })

  async function createLead(token: string, extra: Record<string, unknown> = {}) {
    const res = await app.inject({ method: 'POST', url: '/api/commercial/leads', headers: bearer(token), payload: { name: 'Empresa X', ...extra } })
    return { status: res.statusCode, body: res.json() as { id: string; ownerId: string } }
  }

  it('vendedor só cria leads para si mesmo, mesmo informando outro responsável', async () => {
    const { status, body } = await createLead(sellerTok, { ownerId: otherSellerId })
    expect(status).toBe(201)
    expect(body.ownerId).toBe(sellerId)
  })

  it('vendedor não enxerga nem altera lead de outro vendedor', async () => {
    const { body: lead } = await createLead(otherSellerTok)

    const list = await app.inject({ method: 'GET', url: '/api/commercial/leads', headers: bearer(sellerTok) })
    expect((list.json() as unknown[]).length).toBe(0)

    // Tentar filtrar pelo outro dono não escapa do escopo.
    const filtered = await app.inject({ method: 'GET', url: `/api/commercial/leads?ownerId=${otherSellerId}`, headers: bearer(sellerTok) })
    expect((filtered.json() as unknown[]).length).toBe(0)

    const get = await app.inject({ method: 'GET', url: `/api/commercial/leads/${lead.id}`, headers: bearer(sellerTok) })
    expect(get.statusCode).toBe(404)

    const patch = await app.inject({ method: 'PATCH', url: `/api/commercial/leads/${lead.id}`, headers: bearer(sellerTok), payload: { name: 'Hack' } })
    expect(patch.statusCode).toBe(404)

    const act = await app.inject({ method: 'POST', url: `/api/commercial/leads/${lead.id}/activities`, headers: bearer(sellerTok), payload: { type: 'NOTE', content: 'x' } })
    expect(act.statusCode).toBe(404)
  })

  it('vendedor não reatribui o próprio lead nem exclui leads', async () => {
    const { body: lead } = await createLead(sellerTok)
    const reassign = await app.inject({ method: 'PATCH', url: `/api/commercial/leads/${lead.id}`, headers: bearer(sellerTok), payload: { ownerId: otherSellerId } })
    expect(reassign.statusCode).toBe(403)

    const del = await app.inject({ method: 'DELETE', url: `/api/commercial/leads/${lead.id}`, headers: bearer(sellerTok) })
    expect(del.statusCode).toBe(403)
  })

  it('gerente vê todos os leads e pode reatribuir', async () => {
    await createLead(sellerTok)
    await createLead(otherSellerTok)
    const list = await app.inject({ method: 'GET', url: '/api/commercial/leads', headers: bearer(managerTok) })
    expect((list.json() as unknown[]).length).toBe(2)

    const { body: lead } = await createLead(sellerTok)
    const reassign = await app.inject({ method: 'PATCH', url: `/api/commercial/leads/${lead.id}`, headers: bearer(managerTok), payload: { ownerId: otherSellerId } })
    expect(reassign.statusCode).toBe(200)
    expect((reassign.json() as { ownerId: string }).ownerId).toBe(otherSellerId)
  })

  it('responsável inexistente ou inativo é recusado com 400 (não 500)', async () => {
    const missing = await createLead(managerTok, { ownerId: 'nao-existe' })
    expect(missing.status).toBe(400)

    await prisma.user.update({ where: { id: otherSellerId }, data: { active: false } })
    const inactive = await createLead(managerTok, { ownerId: otherSellerId })
    expect(inactive.status).toBe(400)
  })

  it('valor infinito ou absurdo é recusado', async () => {
    expect((await createLead(managerTok, { value: 'Infinity' })).status).toBe(400)
    expect((await createLead(managerTok, { value: 1e12 })).status).toBe(400)
    expect((await createLead(managerTok, { value: -1 })).status).toBe(400)
  })

  it('campos de texto têm limite de tamanho', async () => {
    const res = await createLead(managerTok, { notes: 'x'.repeat(6000) })
    expect(res.status).toBe(400)
  })

  it('lead ganho vira cliente e não pode mais ser excluído', async () => {
    const { body: lead } = await createLead(managerTok)
    const won = await stageByKind('WON')
    const move = await app.inject({ method: 'PATCH', url: `/api/commercial/leads/${lead.id}/stage`, headers: bearer(managerTok), payload: { stageId: won.id } })
    expect(move.statusCode).toBe(200)
    expect(await prisma.customer.count({ where: { leadId: lead.id } })).toBe(1)

    const del = await app.inject({ method: 'DELETE', url: `/api/commercial/leads/${lead.id}`, headers: bearer(adminTok) })
    expect(del.statusCode).toBe(409)
    expect(await prisma.customer.count({ where: { leadId: lead.id } })).toBe(1)
  })

  it('marcar como perdido exige motivo', async () => {
    const { body: lead } = await createLead(managerTok)
    const lost = await stageByKind('LOST')
    const noReason = await app.inject({ method: 'PATCH', url: `/api/commercial/leads/${lead.id}/stage`, headers: bearer(managerTok), payload: { stageId: lost.id } })
    expect(noReason.statusCode).toBe(400)
    const ok = await app.inject({ method: 'PATCH', url: `/api/commercial/leads/${lead.id}/stage`, headers: bearer(managerTok), payload: { stageId: lost.id, lostReason: 'Sem orçamento' } })
    expect(ok.statusCode).toBe(200)
  })

  it('vendedor só vê as próprias tarefas e clientes', async () => {
    const { body: otherLead } = await createLead(otherSellerTok)
    await app.inject({ method: 'POST', url: '/api/commercial/tasks', headers: bearer(otherSellerTok), payload: { title: 'Ligar', dueAt: new Date().toISOString(), leadId: otherLead.id } })
    const won = await stageByKind('WON')
    await app.inject({ method: 'PATCH', url: `/api/commercial/leads/${otherLead.id}/stage`, headers: bearer(otherSellerTok), payload: { stageId: won.id } })

    const tasks = await app.inject({ method: 'GET', url: '/api/commercial/tasks', headers: bearer(sellerTok) })
    expect((tasks.json() as unknown[]).length).toBe(0)
    const customers = await app.inject({ method: 'GET', url: '/api/commercial/customers', headers: bearer(sellerTok) })
    expect((customers.json() as unknown[]).length).toBe(0)

    // Vendedor não cria tarefa em lead alheio.
    const t = await app.inject({ method: 'POST', url: '/api/commercial/tasks', headers: bearer(sellerTok), payload: { title: 'x', dueAt: new Date().toISOString(), leadId: otherLead.id } })
    expect(t.statusCode).toBe(404)
  })

  it('só admin mexe em usuários e etapas; gerente lista usuários ativos', async () => {
    const asSeller = await app.inject({ method: 'GET', url: '/api/users', headers: bearer(sellerTok) })
    expect(asSeller.statusCode).toBe(403)
    const asManager = await app.inject({ method: 'GET', url: '/api/users', headers: bearer(managerTok) })
    expect(asManager.statusCode).toBe(200)

    const createByManager = await app.inject({ method: 'POST', url: '/api/users', headers: bearer(managerTok), payload: { name: 'N', email: 'n@test.local', password: 'Senha2026ok' } })
    expect(createByManager.statusCode).toBe(403)

    const stageByManager = await app.inject({ method: 'POST', url: '/api/commercial/stages', headers: bearer(managerTok), payload: { name: 'Nova' } })
    expect(stageByManager.statusCode).toBe(403)
  })

  it('reordenação de etapas exige a lista completa', async () => {
    const stages = await prisma.stage.findMany({ orderBy: { position: 'asc' } })
    const partial = await app.inject({ method: 'PUT', url: '/api/commercial/stages/reorder', headers: bearer(adminTok), payload: { ids: [stages[0].id] } })
    expect(partial.statusCode).toBe(400)
    const full = await app.inject({ method: 'PUT', url: '/api/commercial/stages/reorder', headers: bearer(adminTok), payload: { ids: stages.map((s) => s.id).reverse() } })
    expect(full.statusCode).toBe(200)
  })

  it('mudar o tipo de uma etapa com leads dentro é bloqueado', async () => {
    const open = await stageByKind('OPEN')
    await createLead(managerTok, { stageId: open.id })
    const res = await app.inject({ method: 'PATCH', url: `/api/commercial/stages/${open.id}`, headers: bearer(adminTok), payload: { kind: 'WON' } })
    expect(res.statusCode).toBe(409)
  })
})
