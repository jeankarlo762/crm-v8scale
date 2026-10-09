import { describe, it, expect } from 'vitest'
import { computeMetrics, evaluate, wilson, fmtRate, type Prediction } from './website-eval.service'
import { SEED_CASES } from './website-eval-seed'

const p = (id: string, status: Prediction['status'], truth: Prediction['truth'], calls: number | null = null): Prediction => ({ id, status, reason: 'X', truth, confidence: 0.5, calls, synthetic: false })

describe('métricas da avaliação (aritmética conferida à mão)', () => {
  const preds: Prediction[] = [
    p('1', 'HAS_WEBSITE', 'HAS_WEBSITE', 1), p('2', 'HAS_WEBSITE', 'HAS_WEBSITE', 0), p('3', 'HAS_WEBSITE', 'NO_WEBSITE', 2), // falso positivo de site: 1/3
    p('4', 'PROBABLY_NO_WEBSITE', 'NO_WEBSITE', 2), p('5', 'SOCIAL_ONLY', 'NO_WEBSITE', 3), p('6', 'PROBABLY_NO_WEBSITE', 'HAS_WEBSITE', 2), p('7', 'PROBABLY_NO_WEBSITE', 'NO_WEBSITE', 2), // falso sem site: 1/4
    p('8', 'UNKNOWN', 'NO_WEBSITE'), p('9', 'CONFLICT', 'HAS_WEBSITE'), // revisão manual: 2/9
    p('10', 'UNKNOWN', null), // sem rótulo: fora das taxas de acerto, dentro das de volume
  ]
  const m = computeMetrics(preds)
  it('falso positivo de site e falso "sem site"', () => {
    expect(m.falsePositiveSite).toMatchObject({ num: 1, den: 3 })
    expect(m.falsePositiveSite.rate).toBeCloseTo(1 / 3)
    expect(m.falseNoSite).toMatchObject({ num: 1, den: 4 })
    expect(m.releasedPrecision).toMatchObject({ num: 3, den: 4 })
  })
  it('proporção resolvida automaticamente e enviada à revisão manual (sobre TODOS, inclusive sem rótulo)', () => {
    expect(m.autoResolved).toMatchObject({ num: 7, den: 10 })
    expect(m.manualReview).toMatchObject({ num: 3, den: 10 })
    expect(m.total).toBe(10); expect(m.labeled).toBe(9)
  })
  it('consumo por lead resolvido usa só leads com dado de consumo', () => {
    expect(m.callsPerResolved).toMatchObject({ calls: 12, resolved: 7, perResolved: 12 / 7 })
  })
  it('recall de "sem site" e matriz de confusão', () => {
    expect(m.recallNoSite).toMatchObject({ num: 3, den: 5 })
    expect(m.confusion.NO_WEBSITE).toMatchObject({ PROBABLY_NO_WEBSITE: 2, SOCIAL_ONLY: 1, UNKNOWN: 1, HAS_WEBSITE: 1 })
  })
  it('sem rótulos não há métrica inventada', () => {
    const none = computeMetrics([p('a', 'UNKNOWN', null)])
    expect(none.falseNoSite.rate).toBeNull()
    expect(none.falsePositiveSite.ci95).toBeNull()
    expect(none.note).toContain('Sem rótulos')
    expect(fmtRate(none.falseNoSite)).toBe('n/d')
  })
  it('intervalo de Wilson é largo com amostra pequena e estreita com amostra grande', () => {
    const [lo, hi] = wilson(1, 4)!
    expect(lo).toBeCloseTo(0.0456, 2); expect(hi).toBeCloseTo(0.6994, 2)
    const [l2, h2] = wilson(250, 1000)!
    expect(h2 - l2).toBeLessThan(0.06)
    expect(wilson(0, 0)).toBeNull()
  })
})

describe('conjunto sintético (regressão, NÃO é medida de desempenho)', () => {
  const out = evaluate(SEED_CASES)
  it('cada caso cai na decisão esperada', () => {
    for (const r of out.results) expect(r.prediction.status, `${r.case.id} (${r.prediction.reason})`).toBe((r.case as typeof SEED_CASES[number]).expectStatus)
  })
  it('nenhum erro grave nos casos conhecidos: zero "sem site" falso liberado e zero "tem site" falso', () => {
    expect(out.metrics.falseNoSite.num).toBe(0)
    expect(out.metrics.falsePositiveSite.num).toBe(0)
  })
  it('marca o resultado como sintético', () => { expect(out.syntheticOnly).toBe(true) })
  it('incerteza vai para revisão manual em vez de virar erro', () => {
    expect(out.metrics.manualReview.num).toBeGreaterThanOrEqual(3)
  })
})
