import { describe, it, expect, vi } from 'vitest'
vi.mock('../config/database', () => ({ prisma: {} }))
import { nextConfirmation, legacyConfirmation, type ConfirmationRecord } from './site-classify-queue.service'
import { resolveFromEvidence } from './website-resolve.service'
import { LEAD, opts, factsRow, googleRow, searchRow, OWN_PAGE, hoursAgo } from './website-test-fixtures'

const decision = (valid: boolean, at: string | null, source = 'GOOGLE', url = 'https://arenatribo.com.br') => ({ confirmation: { valid, url: valid ? url : null, source: valid ? source : null, at, evidence: [] }, primaryReason: valid ? 'IDENTITY_CONFIRMED' : 'CONFIRMATION_EXPIRED' })
const BASE = Date.now()
const iso = (h: number) => new Date(BASE - h * 3600_000).toISOString()

describe('datas de confirmação: coleta real ≠ recálculo ≠ manual ≠ revalidação efetiva', () => {
  it('confirmação nova usa a data da EVIDÊNCIA (coleta real), não a do recálculo', () => {
    const now = new Date()
    const c = nextConfirmation(null, decision(true, iso(48)), now)
    expect(c).toMatchObject({ valid: true, confirmedAt: iso(48), collectedAt: iso(48), revalidatedAt: iso(48) })
    expect(c.recomputedAt).toBe(now.toISOString())
    expect(c.confirmedAt).not.toBe(now.toISOString())
  })

  it('recálculo SEM rede com a mesma evidência antiga NÃO renova revalidatedAt/confirmedAt (só recomputedAt avança)', () => {
    const first = nextConfirmation(null, decision(true, iso(72)), new Date(Date.now() - 3600_000))
    const later = new Date()
    const again = nextConfirmation(first, decision(true, iso(72)), later) // mesma evidência, recalculada agora (cache/migração/dry-run)
    expect(again.revalidatedAt).toBe(first.revalidatedAt)
    expect(again.confirmedAt).toBe(first.confirmedAt)
    expect(again.collectedAt).toBe(first.collectedAt)
    expect(again.recomputedAt).toBe(later.toISOString())
  })

  it('evidência de CACHE mais antiga que a revalidação atual nunca a faz regredir nem avançar', () => {
    const first = nextConfirmation(null, decision(true, iso(10)), new Date())
    const viaCache = nextConfirmation(first, decision(true, iso(200)), new Date())
    expect(viaCache.revalidatedAt).toBe(iso(10))
  })

  it('só evidência MAIS NOVA (nova coleta real) avança a revalidação efetiva', () => {
    const first = nextConfirmation(null, decision(true, iso(72)), new Date())
    const fresh = nextConfirmation(first, decision(true, iso(1)), new Date())
    expect(fresh.revalidatedAt).toBe(iso(1))
    expect(fresh.confirmedAt).toBe(first.confirmedAt) // a confirmação original não muda
  })

  it('confirmação manual tem data própria e não vira "revalidação"', () => {
    const now = new Date()
    const m = nextConfirmation(null, decision(true, null, 'MANUAL'), now)
    expect(m).toMatchObject({ manualConfirmedAt: now.toISOString(), revalidatedAt: null, collectedAt: null })
    const later = new Date(now.getTime() + 5000)
    const again = nextConfirmation(m, decision(true, null, 'MANUAL'), later)
    expect(again.manualConfirmedAt).toBe(now.toISOString()) // recalcular não reconfirma
    expect(again.revalidatedAt).toBeNull()
  })

  it('confirmação vencida vira HISTÓRICO inválido (motivo registrado), preservando as datas originais', () => {
    const first = nextConfirmation(null, decision(true, iso(24 * 30)), new Date(Date.now() - 86_400_000))
    const now = new Date()
    const expired = nextConfirmation(first, decision(false, null), now)
    expect(expired).toMatchObject({ valid: false, invalidReason: 'CONFIRMATION_EXPIRED', url: 'https://arenatribo.com.br', confirmedAt: first.confirmedAt, revalidatedAt: first.revalidatedAt })
    expect(expired.invalidatedAt).toBe(now.toISOString())
  })

  it('legado (confirmedWebsite sem datas) continua inválido até ser reconfirmado por evidência', () => {
    const l = legacyConfirmation('https://velho.com') as ConfirmationRecord
    expect(l).toMatchObject({ valid: false, confirmedAt: null, revalidatedAt: null })
    const same = nextConfirmation(l, decision(false, null, 'GOOGLE', 'https://velho.com'), new Date())
    expect(same.valid).toBe(false)
  })

  it('ponta a ponta sem rede: fato vencido que confirmaria o site → decisão incompleta e confirmação INVÁLIDA; nada é "recém-validado"', () => {
    const l = { ...LEAD, website: 'https://arenatribo.com.br' }
    const prev = nextConfirmation(null, decision(true, iso(24 * 30)), new Date(Date.now() - 86_400_000))
    const r = resolveFromEvidence(l, [googleRow({ lead: l, websiteUri: l.website }), searchRow('NAME', [], { lead: l }), factsRow('https://arenatribo.com.br', OWN_PAGE, { collectedAt: hoursAgo(24 * 30) })], opts({}, l))
    expect(r.decision.confirmation.valid).toBe(false)
    const rec = nextConfirmation(prev, r.decision, new Date())
    expect(rec.valid).toBe(false)
    expect(rec.revalidatedAt).toBe(prev.revalidatedAt) // nada renovado
  })
})
