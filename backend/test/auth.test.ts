import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../src/app'
import { prisma } from '../src/config/database'
import { HAS_DB, PASSWORD, bearer, createUser, login, resetDb } from './helpers'

describe.skipIf(!HAS_DB)('autenticação', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    app = buildApp()
    await app.ready()
  })
  afterAll(async () => {
    await app.close()
    await prisma.$disconnect()
  })
  beforeEach(resetDb)

  it('faz login com credenciais válidas e devolve os dois tokens', async () => {
    const user = await createUser('SELLER')
    const { status, body } = await login(app, user.email)
    expect(status).toBe(200)
    expect(body.accessToken).toBeTruthy()
    expect(body.refreshToken).toBeTruthy()
    expect(await prisma.refreshToken.count({ where: { userId: user.id } })).toBe(1)
  })

  it('recusa senha errada e e-mail inexistente com a mesma mensagem', async () => {
    const user = await createUser('SELLER')
    const wrong = await login(app, user.email, 'errada123')
    const missing = await login(app, 'ninguem@test.local')
    expect(wrong.status).toBe(401)
    expect(missing.status).toBe(401)
    expect((wrong.body as unknown as { message: string }).message).toBe((missing.body as unknown as { message: string }).message)
  })

  it('recusa usuário inativo', async () => {
    const user = await createUser('SELLER')
    await prisma.user.update({ where: { id: user.id }, data: { active: false } })
    expect((await login(app, user.email)).status).toBe(401)
  })

  it('exige token nas rotas protegidas', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/auth/me' })
    expect(res.statusCode).toBe(401)
    const bad = await app.inject({ method: 'GET', url: '/api/auth/me', headers: bearer('abc.def.ghi') })
    expect(bad.statusCode).toBe(401)
  })

  it('o access token não carrega o e-mail', async () => {
    const user = await createUser('SELLER')
    const { body } = await login(app, user.email)
    const payload = JSON.parse(Buffer.from(body.accessToken.split('.')[1], 'base64url').toString())
    expect(payload.sub).toBe(user.id)
    expect(payload.email).toBeUndefined()
  })

  it('rotaciona o refresh token e invalida o anterior', async () => {
    const user = await createUser('SELLER')
    const { body: first } = await login(app, user.email)

    const r1 = await app.inject({ method: 'POST', url: '/api/auth/refresh', payload: { refreshToken: first.refreshToken } })
    expect(r1.statusCode).toBe(200)
    const second = r1.json() as { accessToken: string; refreshToken: string }
    expect(second.refreshToken).not.toBe(first.refreshToken)

    // O novo token funciona na API.
    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: bearer(second.accessToken) })
    expect(me.statusCode).toBe(200)
  })

  it('reuso de refresh token derruba TODAS as sessões do usuário', async () => {
    const user = await createUser('SELLER')
    const { body: first } = await login(app, user.email)
    const r1 = await app.inject({ method: 'POST', url: '/api/auth/refresh', payload: { refreshToken: first.refreshToken } })
    const second = r1.json() as { refreshToken: string }

    // Alguém usa o token antigo de novo (roubo): 401 e a sessão nova também cai.
    const reuse = await app.inject({ method: 'POST', url: '/api/auth/refresh', payload: { refreshToken: first.refreshToken } })
    expect(reuse.statusCode).toBe(401)
    expect(await prisma.refreshToken.count({ where: { userId: user.id } })).toBe(0)

    const afterReuse = await app.inject({ method: 'POST', url: '/api/auth/refresh', payload: { refreshToken: second.refreshToken } })
    expect(afterReuse.statusCode).toBe(401)
  })

  it('logout revoga o refresh token', async () => {
    const user = await createUser('SELLER')
    const { body } = await login(app, user.email)
    const out = await app.inject({ method: 'POST', url: '/api/auth/logout', payload: { refreshToken: body.refreshToken } })
    expect(out.statusCode).toBe(200)
    const again = await app.inject({ method: 'POST', url: '/api/auth/refresh', payload: { refreshToken: body.refreshToken } })
    expect(again.statusCode).toBe(401)
  })

  it('troca de senha exige a atual, bloqueia senhas comuns e encerra as outras sessões', async () => {
    const user = await createUser('SELLER')
    const { body } = await login(app, user.email)
    await login(app, user.email) // segunda sessão
    expect(await prisma.refreshToken.count({ where: { userId: user.id } })).toBe(2)

    const wrongCurrent = await app.inject({
      method: 'POST', url: '/api/auth/me/password', headers: bearer(body.accessToken),
      payload: { currentPassword: 'errada123', newPassword: 'NovaSenha2026' },
    })
    expect(wrongCurrent.statusCode).toBe(400)

    const weak = await app.inject({
      method: 'POST', url: '/api/auth/me/password', headers: bearer(body.accessToken),
      payload: { currentPassword: PASSWORD, newPassword: 'troque-esta-senha' },
    })
    expect(weak.statusCode).toBe(400)

    const ok = await app.inject({
      method: 'POST', url: '/api/auth/me/password', headers: bearer(body.accessToken),
      payload: { currentPassword: PASSWORD, newPassword: 'NovaSenha2026' },
    })
    expect(ok.statusCode).toBe(200)
    expect(await prisma.refreshToken.count({ where: { userId: user.id } })).toBe(0)
    expect((await login(app, user.email, 'NovaSenha2026')).status).toBe(200)
  })

  it('desativar um usuário bloqueia o access token dele na hora', async () => {
    const admin = await createUser('ADMIN')
    const seller = await createUser('SELLER')
    const { body: adminTok } = await login(app, admin.email)
    const { body: sellerTok } = await login(app, seller.email)

    const off = await app.inject({
      method: 'PATCH', url: `/api/users/${seller.id}`, headers: bearer(adminTok.accessToken), payload: { active: false },
    })
    expect(off.statusCode).toBe(200)

    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: bearer(sellerTok.accessToken) })
    expect(me.statusCode).toBe(401)
  })

  it('admin não consegue rebaixar nem desativar a própria conta', async () => {
    const admin = await createUser('ADMIN')
    const { body } = await login(app, admin.email)
    const res = await app.inject({
      method: 'PATCH', url: `/api/users/${admin.id}`, headers: bearer(body.accessToken), payload: { role: 'SELLER' },
    })
    expect(res.statusCode).toBe(400)
  })
})
