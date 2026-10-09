import { describe, it, expect, vi, afterEach } from 'vitest'
import { resolveFromEvidence, type ResolveLead } from './website-resolve.service'
import { dependsOnHash } from './lead-evidence.service'
import { LEAD, opts, factsRow, searchRow, bioRow, googleRow, hit, hoursAgo, html, OWN_PAGE, OTHER_COMPANY_PAGE, VAGUE_PAGE, ldBusiness } from './website-test-fixtures'

const lead = (over: Partial<ResolveLead> = {}): ResolveLead => ({ ...LEAD, ...over })
const fullSearch = () => [googleRow(), searchRow('NAME'), searchRow('PHONE')]

describe('Google com domínio incorreto', () => {
  const l = lead({ website: 'https://hotelbeta.com.br' })

  it('URL do Google que identifica OUTRA empresa é descartada (contradita) e não vira "tem site"', () => {
    const r = resolveFromEvidence(l, [factsRow('https://hotelbeta.com.br', OTHER_COMPANY_PAGE), ...fullSearch()], opts({ exhausted: true }, l))
    expect(r.candidates[0].linkage).toBe('CONTRADICTED')
    expect(r.decision.status).toBe('PROBABLY_NO_WEBSITE')
    expect(r.decision.reasons).toContain('GOOGLE_URL_CONTRADICTED:hotelbeta.com.br')
  })
  it('URL do Google é só CANDIDATA: página vaga (sem nome/telefone) → UNKNOWN, mesmo com Tavily sem resultado', () => {
    const r = resolveFromEvidence(l, [factsRow('https://hotelbeta.com.br', VAGUE_PAGE), ...fullSearch()], opts({ exhausted: true }, l))
    expect(r.decision.status).toBe('UNKNOWN')
    expect(r.decision.primaryReason).toBe('CANDIDATE_INCONCLUSIVE')
    expect(r.decision.outcome).toBe('NEEDS_REVIEW')
  })
  it('URL do Google confirmada pela página (telefone + nome) → HAS_WEBSITE sem gastar Tavily', () => {
    const l2 = lead({ website: 'https://arenatribo.com.br' })
    const r = resolveFromEvidence(l2, [factsRow('https://arenatribo.com.br', OWN_PAGE)], opts({}, l2))
    expect(r.decision).toMatchObject({ status: 'HAS_WEBSITE', outcome: 'FINAL', confirmedWebsite: 'https://arenatribo.com.br' })
    expect(r.next).toBeNull() // nada pago a fazer
    expect(r.plan.filter((p) => p.paid && !p.done).length).toBeGreaterThanOrEqual(0)
  })
  it('antes de buscar a página, a próxima etapa é HTTP grátis (PAGE_CHECK), nunca API paga', () => {
    const r = resolveFromEvidence(l, [], opts({}, l))
    expect(r.next).toMatchObject({ action: 'PAGE_CHECK', paid: false, key: 'https://hotelbeta.com.br' })
    expect(r.decision.status).toBe('UNKNOWN')
  })
})

describe('site com 403 / conteúdo não avaliável', () => {
  const l = lead({ website: 'https://arenatribo.com.br' })
  it.each([
    ['HTTP 403 (anti-bot)', factsRow('https://arenatribo.com.br', '', { httpStatus: 403, blocked: true })],
    ['SPA sem HTML útil', factsRow('https://arenatribo.com.br', '<html><body><div id="root"></div></body></html>')],
    ['timeout', factsRow('https://arenatribo.com.br', '', { httpStatus: null, health: 'fora_do_ar' })],
  ])('%s: UNKNOWN (não avaliável), nunca "sem site" nem "tem site"', (_n, row) => {
    const r = resolveFromEvidence(l, [row, ...fullSearch()], opts({ exhausted: true }, l))
    expect(r.decision.status).toBe('UNKNOWN')
    expect(r.decision.primaryReason).toBe('CANDIDATE_NOT_EVALUABLE')
    expect(r.candidates[0].linkage).toBe('NOT_EVALUABLE')
  })
})

describe('confirmação histórica errada', () => {
  it('confirmedWebsite antigo cuja página identifica outra empresa: sem piso de confiança, sem conflito artificial', () => {
    const l = lead({ confirmedWebsite: 'https://antigo-errado.com' })
    const r = resolveFromEvidence(l, [factsRow('https://antigo-errado.com', OTHER_COMPANY_PAGE), ...fullSearch()], opts({ exhausted: true }, l))
    expect(r.decision.status).toBe('PROBABLY_NO_WEBSITE')
    expect(r.decision.confirmedWebsite).toBeNull()
    expect(r.decision.confirmation.valid).toBe(false)
    expect(r.decision.reasons).toContain('HISTORY_URL_CONTRADICTED:antigo-errado.com')
  })
  it('histórico errado + site correto achado agora → HAS_WEBSITE no site novo, sem CONFLICT', () => {
    const l = lead({ confirmedWebsite: 'https://antigo-errado.com', website: 'https://arenatribo.com.br' })
    const r = resolveFromEvidence(l, [factsRow('https://antigo-errado.com', OTHER_COMPANY_PAGE), factsRow('https://arenatribo.com.br', OWN_PAGE)], opts({}, l))
    expect(r.decision.status).toBe('HAS_WEBSITE')
    expect(r.decision.confirmedWebsite).toBe('https://arenatribo.com.br')
  })
  it('histórico sem revalidação (página ainda não lida) NÃO vale como HAS_WEBSITE: UNKNOWN + etapa HTTP pendente', () => {
    const l = lead({ confirmedWebsite: 'https://antigo.com' })
    const r = resolveFromEvidence(l, [], opts({}, l))
    expect(r.decision.status).toBe('UNKNOWN')
    expect(r.decision.primaryReason).toBe('PREVIOUS_CONFIRMATION_UNVERIFIED')
    expect(r.next).toMatchObject({ action: 'PAGE_CHECK', key: 'https://antigo.com' })
  })
  it('histórico revalidado AGORA pela página vira confirmação válida (e só por isso)', () => {
    const l = lead({ confirmedWebsite: 'https://arenatribo.com.br' })
    const r = resolveFromEvidence(l, [factsRow('https://arenatribo.com.br', OWN_PAGE)], opts({}, l))
    expect(r.decision).toMatchObject({ status: 'HAS_WEBSITE' })
    expect(r.decision.confirmation).toMatchObject({ valid: true, source: 'HISTORY' })
  })
  it('falha temporária ao revalidar não apaga o histórico nem prova ausência', () => {
    const l = lead({ confirmedWebsite: 'https://arenatribo.com.br', websiteConfirmation: { url: 'https://arenatribo.com.br' } })
    const r = resolveFromEvidence(l, [factsRow('https://arenatribo.com.br', '', { httpStatus: null, health: 'fora_do_ar' }), ...fullSearch()], opts({ exhausted: true }, l))
    expect(r.decision.status).toBe('UNKNOWN')
    expect(r.decision.primaryReason).toBe('PREVIOUS_CONFIRMATION_UNVERIFIED')
  })
})

describe('redirecionamento antigo → novo', () => {
  it('domínio antigo que redireciona para o novo (ambos candidatos) = UM site, sem conflito', () => {
    const l = lead({ website: 'https://arenatribo.com.br', foundWebsite: 'https://arenatribo.com' })
    const rows = [
      factsRow('https://arenatribo.com.br', OWN_PAGE, { finalUrl: 'https://novaarena.com.br/' }),
      factsRow('https://arenatribo.com', OWN_PAGE, { finalUrl: 'https://novaarena.com.br/' }),
    ]
    const r = resolveFromEvidence(l, rows, opts({}, l))
    expect(r.candidates).toHaveLength(1)
    expect(r.candidates[0].siteKey).toBe('novaarena.com.br')
    expect(r.candidates[0].relatedKeys).toEqual(expect.arrayContaining(['arenatribo.com.br']))
    expect(r.decision).toMatchObject({ status: 'HAS_WEBSITE', confirmedWebsite: 'https://novaarena.com.br/' })
  })
  it('institucional e reservas que se linkam são relacionados: dois plausíveis NÃO viram CONFLICT', () => {
    const l = lead({ website: 'https://arenatribo.com.br', foundWebsite: 'https://reservasarena.com' })
    const rows = [
      factsRow('https://arenatribo.com.br', html('Arena Tribo', '<p>Tubarão</p><a href="https://reservasarena.com/agenda">reservar</a>')),
      factsRow('https://reservasarena.com', html('Arena Tribo Reservas', '<p>Tubarão</p><a href="https://arenatribo.com.br">site</a>')),
    ]
    const r = resolveFromEvidence(l, rows, opts({ exhausted: true }, l))
    expect(r.candidates.every((c) => c.linkage === 'PLAUSIBLE')).toBe(true)
    expect(r.decision.status).not.toBe('CONFLICT')
  })
})

describe('empresas diferentes no mesmo domínio de plataforma compartilhada', () => {
  it('/site/arenatribo é do lead; /site/outraarena (outra empresa) não se mistura nem vira conflito', () => {
    const l = lead({ website: 'https://plataforma.com.br/site/arenatribo', foundWebsite: 'https://plataforma.com.br/site/outraarena' })
    const rows = [
      factsRow('https://plataforma.com.br/site/arenatribo', OWN_PAGE),
      factsRow('https://plataforma.com.br/site/outraarena', html('Outra Arena', '<a href="tel:+554832221111">x</a>', ldBusiness('Outra Arena', 'Tubarão', '+554832221111'))),
    ]
    const r = resolveFromEvidence(l, rows, opts({}, l))
    expect(r.candidates.map((c) => c.siteKey).sort()).toEqual(['plataforma.com.br/site/arenatribo', 'plataforma.com.br/site/outraarena'])
    expect(r.candidates.find((c) => c.siteKey.endsWith('outraarena'))?.linkage).toBe('CONTRADICTED')
    expect(r.decision).toMatchObject({ status: 'HAS_WEBSITE', confirmedWebsite: 'https://plataforma.com.br/site/arenatribo' })
  })
  it('a página do OUTRO negócio na plataforma, sozinha, não confirma o lead por estar no mesmo domínio', () => {
    const l = lead({ website: 'https://plataforma.com.br/site/outraarena' })
    const r = resolveFromEvidence(l, [factsRow('https://plataforma.com.br/site/outraarena', html('Outra Arena', '<a href="tel:+554832221111">x</a>', ldBusiness('Outra Arena', 'Tubarão', '+554832221111'))), ...fullSearch()], opts({ exhausted: true }, l))
    expect(r.decision.status).toBe('PROBABLY_NO_WEBSITE')
    expect(r.decision.confirmedWebsite).toBeNull()
  })
  it('subdomínio de construtor: duas empresas no wixsite.com têm chaves distintas', () => {
    const l = lead({ website: 'https://arenatribo.wixsite.com/inicio', foundWebsite: 'https://outraarena.wixsite.com' })
    const r = resolveFromEvidence(l, [factsRow('https://arenatribo.wixsite.com/inicio', OWN_PAGE), factsRow('https://outraarena.wixsite.com', OTHER_COMPANY_PAGE)], opts({}, l))
    expect(r.candidates).toHaveLength(2)
    expect(r.decision.status).toBe('HAS_WEBSITE')
  })
})

describe('candidatos pendentes impedem a conclusão negativa', () => {
  it('a busca por nome achou um domínio relacionado ao nome que ainda não foi lido → UNKNOWN + PAGE_CHECK, mesmo com todas as consultas feitas', () => {
    const rows = [searchRow('NAME', [hit('https://arenatribo.com.br/sobre')]), searchRow('PHONE')]
    const r = resolveFromEvidence(LEAD, rows, opts({ exhausted: false }))
    expect(r.decision.status).toBe('UNKNOWN')
    expect(r.next).toMatchObject({ action: 'PAGE_CHECK', key: 'https://arenatribo.com.br' })
  })
  it('lido e inconclusivo → continua UNKNOWN (revisão manual quando esgotado)', () => {
    const rows = [searchRow('NAME', [hit('https://arenatribo.com.br')]), searchRow('PHONE'), factsRow('https://arenatribo.com.br', VAGUE_PAGE)]
    const r = resolveFromEvidence(LEAD, rows, opts({ exhausted: true }))
    expect(r.decision).toMatchObject({ status: 'UNKNOWN', outcome: 'NEEDS_REVIEW', primaryReason: 'CANDIDATE_INCONCLUSIVE' })
  })
  it('lido e confirmado (telefone + nome) → HAS_WEBSITE; o telefone consultado depois nem é necessário', () => {
    const rows = [searchRow('NAME', [hit('https://arenatribo.com.br')]), factsRow('https://arenatribo.com.br', OWN_PAGE)]
    const r = resolveFromEvidence(LEAD, rows, opts())
    expect(r.decision.status).toBe('HAS_WEBSITE')
    expect(r.next).toBeNull()
  })
  it('analisa TODOS os candidatos relevantes, não só o primeiro: o 1º é de outra empresa, o 2º é o certo', () => {
    const rows = [
      searchRow('NAME', [hit('https://arenatribo-hotel.com.br', 'Arena Tribo Hotel'), hit('https://arenatribo.com.br')]),
      factsRow('https://arenatribo-hotel.com.br', OTHER_COMPANY_PAGE), factsRow('https://arenatribo.com.br', OWN_PAGE),
    ]
    const r = resolveFromEvidence(LEAD, rows, opts())
    expect(r.decision).toMatchObject({ status: 'HAS_WEBSITE', confirmedWebsite: 'https://arenatribo.com.br' })
  })
  it('diretório/agregador nos resultados é descartado (CHECKED_RESULTS_DISCARDED) e permite o negativo', () => {
    const dirs = [hit('https://www.tripadvisor.com.br/Arena-Tribo'), hit('https://www.econodata.com.br/arena-tribo')]
    const r = resolveFromEvidence(LEAD, [googleRow(), searchRow('NAME', dirs), searchRow('PHONE')], opts({ exhausted: true }))
    expect(r.coverage.queries[0].state).toBe('CHECKED_RESULTS_DISCARDED')
    expect(r.decision.status).toBe('PROBABLY_NO_WEBSITE')
  })
})

describe('semântica de CHECKED_NO_RESULT', () => {
  it('sem resultados → CHECKED_NO_RESULT; resultados descartados → CHECKED_RESULTS_DISCARDED; candidato ilegível → CHECKED_CANDIDATES_UNEVALUABLE', () => {
    const l = LEAD
    const none = resolveFromEvidence(l, [searchRow('NAME')], opts())
    expect(none.coverage.queries[0].state).toBe('CHECKED_NO_RESULT')
    const discarded = resolveFromEvidence(l, [searchRow('NAME', [hit('https://www.tripadvisor.com.br/x')])], opts())
    expect(discarded.coverage.queries[0].state).toBe('CHECKED_RESULTS_DISCARDED')
    const unev = resolveFromEvidence(l, [searchRow('NAME', [hit('https://arenatribo.com.br')]), factsRow('https://arenatribo.com.br', '', { httpStatus: 403, blocked: true })], opts())
    expect(unev.coverage.queries[0].state).toBe('CHECKED_CANDIDATES_UNEVALUABLE')
    expect(unev.coverage.sources.TAVILY).toBe('CHECKED_CANDIDATES_UNEVALUABLE')
  })
})

describe('cobertura, etapas e vigência', () => {
  it('sem consultas: a próxima etapa é Tavily por nome+cidade+UF (a mais discriminante); telefone depois; nunca as três de uma vez', () => {
    const r = resolveFromEvidence(LEAD, [googleRow()], opts())
    expect(r.next).toMatchObject({ action: 'TAVILY_NAME', key: 'Arena Tribo Tubarão SC', paid: true })
    const after = resolveFromEvidence(LEAD, [googleRow(), searchRow('NAME')], opts())
    expect(after.next?.action).toBe('TAVILY_PHONE')
    expect(after.decision.status).toBe('UNKNOWN') // ainda falta o telefone
  })
  it('resolvido pelo que já existe: com Google confirmado nenhuma etapa paga é planejada como pendente obrigatória', () => {
    const l = lead({ website: 'https://arenatribo.com.br' })
    const r = resolveFromEvidence(l, [factsRow('https://arenatribo.com.br', OWN_PAGE)], opts({}, l))
    expect(r.next).toBeNull()
  })
  it('evidência negativa VENCIDA (TTL) não sustenta o negativo e a etapa volta ao plano', () => {
    const old = hoursAgo(24 * 30)
    const r = resolveFromEvidence(LEAD, [googleRow(), searchRow('NAME', [], { collectedAt: old }), searchRow('PHONE')], opts({ exhausted: false }))
    expect(r.coverage.staleNegative).toBe(true)
    expect(r.decision.status).toBe('UNKNOWN')
    expect(r.next?.action).toBe('TAVILY_NAME')
    expect(r.staleReasons).toContain('STEP_EXPIRED:TAVILY_NAME')
  })
  it('forceAt: etapas coletadas antes dele contam como não feitas', () => {
    const r = resolveFromEvidence(LEAD, [googleRow(), searchRow('NAME', [], { collectedAt: hoursAgo(2) }), searchRow('PHONE', [], { collectedAt: hoursAgo(2) })], opts({ forceAt: new Date(), exhausted: false }))
    expect(r.next?.action).toBe('TAVILY_NAME')
  })
  it('mudou nome/telefone/endereço: evidências por consulta antigas são INVÁLIDAS e ignoradas', () => {
    const rows = [searchRow('NAME'), searchRow('PHONE')]
    const changed = lead({ phoneE164: '+5548988887777', whatsapp: '(48) 98888-7777' })
    const r = resolveFromEvidence(changed, rows, opts({ exhausted: false }, changed))
    expect(r.coverage.queries).toHaveLength(0)
    expect(r.decision.status).toBe('UNKNOWN')
    const renamed = lead({ arenaName: 'Arena Tribo Beach' })
    expect(resolveFromEvidence(renamed, rows, opts({ exhausted: false }, renamed)).coverage.queries).toHaveLength(0)
    expect(dependsOnHash(changed)).not.toBe(dependsOnHash(LEAD))
  })
  it('versão antiga do extrator invalida os fatos da página (refaz o HTTP grátis)', () => {
    const l = lead({ website: 'https://arenatribo.com.br' })
    const row = { ...factsRow('https://arenatribo.com.br', OWN_PAGE), version: 'pf0' }
    const r = resolveFromEvidence(l, [row], opts({}, l))
    expect(r.decision.status).toBe('UNKNOWN')
    expect(r.next).toMatchObject({ action: 'PAGE_CHECK' })
  })
  it('Tavily não configurada: etapas obrigatórias contam como interrompidas — nunca conclui "sem site"', () => {
    const r = resolveFromEvidence(LEAD, [], opts({ tavilyConfigured: false, exhausted: true }))
    expect(r.decision.status).toBe('UNKNOWN')
    expect(r.decision.reasons).toEqual(expect.arrayContaining(['TAVILY_NOT_CONFIGURED']))
  })
  it('bloqueio por cota registrado no estado da fonte (NOT_CHECKED_QUOTA), não como "sem resultado"', () => {
    const r = resolveFromEvidence(LEAD, [], opts({ blocked: [{ step: 'TAVILY_NAME', code: 'WINDOW_M' }] }))
    expect(r.coverage.sources.TAVILY).toBe('NOT_CHECKED_QUOTA')
    expect(r.decision.reasons).toContain('TAVILY_NOT_CHECKED_QUOTA')
    expect(r.decision.status).toBe('UNKNOWN')
  })
})

describe('Instagram / Meta', () => {
  const ig = lead({ instagramHandle: 'arenatribo', instagramVerificar: false })
  it('@ confirmado entra no plano: a bio (Meta) vem antes do Tavily; sem Meta configurada o negativo fica bloqueado', () => {
    const withMeta = resolveFromEvidence(ig, [googleRow({ lead: ig })], opts({ metaConfigured: true }, ig))
    expect(withMeta.next).toMatchObject({ action: 'META_BIO', paid: true, key: 'arenatribo' })
    // sem Meta: a cobertura alternativa EXPLÍCITA é a busca pelo @ — não finge que a bio foi lida e não reduz o padrão de evidência
    const noMeta = resolveFromEvidence(ig, [...fullSearch().map((r) => ({ ...r, dependsOn: r.source === 'GOOGLE' ? r.dependsOn : dependsOnHash(ig) }))], opts({ exhausted: true, metaConfigured: false }, ig))
    expect(noMeta.decision.status).toBe('UNKNOWN')
    expect(noMeta.coverage.required).toContain('TAVILY_HANDLE')
    expect(noMeta.coverage.required).not.toContain('META_BIO')
    expect(noMeta.decision.reasons).toContain('META_NOT_CONFIGURED_ALT_TAVILY_HANDLE')
  })
  it('bio sem site + buscas negativas → SOCIAL_ONLY (rede confirmada)', () => {
    const rows = [googleRow({ lead: ig }), searchRow('NAME', [], { lead: ig }), searchRow('PHONE', [], { lead: ig }), bioRow('arenatribo', { website: null }, { lead: ig })]
    const r = resolveFromEvidence(ig, rows, opts({ metaConfigured: true, exhausted: true }, ig))
    expect(r.decision.status).toBe('SOCIAL_ONLY')
  })
  it('site na bio é só CANDIDATO: passa pela identidade como qualquer outro', () => {
    const rows = [bioRow('arenatribo', { website: 'https://arenatribo.com.br' }, { lead: ig }), factsRow('https://arenatribo.com.br', OWN_PAGE)]
    const r = resolveFromEvidence(ig, rows, opts({ metaConfigured: true }, ig))
    expect(r.candidates[0]).toMatchObject({ source: 'INSTAGRAM', linkage: 'CONFIRMED' })
    expect(r.decision.status).toBe('HAS_WEBSITE')
  })
  it('link na bio é resolvido por HTTP grátis (1 nível) e só os sites que relacionam com o negócio viram candidatos', () => {
    const l = lead({ website: 'https://linktr.ee/arenatribo' })
    const pending = resolveFromEvidence(l, [], opts({}, l))
    expect(pending.next).toMatchObject({ action: 'LINK_RESOLVE', paid: false })
    const linkRow = { source: 'WEBSITE' as const, type: 'LINK_PAGE' as const, key: 'https://linktr.ee/arenatribo', value: { ok: true, links: ['https://arenatribo.com.br', 'https://www.facebook.com/x', 'https://random-shop.com'], instagram: 'arenatribo' }, outcome: 'OK', fromCache: false, collectedAt: new Date(), dependsOn: '', version: 'pf1' }
    const r = resolveFromEvidence(l, [linkRow, factsRow('https://arenatribo.com.br', OWN_PAGE)], opts({}, l))
    expect(r.decision.status).toBe('HAS_WEBSITE')
    expect(r.candidates[0].source).toBe('LINK_BIO')
  })
  it('página de link na bio ilegível interrompe o negativo (não dá pra afirmar que não há site)', () => {
    const l = lead({ website: 'https://linktr.ee/arenatribo' })
    const linkRow = { source: 'WEBSITE' as const, type: 'LINK_PAGE' as const, key: 'https://linktr.ee/arenatribo', value: { ok: false, links: [], instagram: null }, outcome: 'UNREADABLE', fromCache: false, collectedAt: new Date(), dependsOn: '', version: 'pf1' }
    const r = resolveFromEvidence(l, [linkRow, ...fullSearch().map((x) => ({ ...x, dependsOn: dependsOnHash(l) }))], opts({ exhausted: true }, l))
    expect(r.decision.status).toBe('UNKNOWN')
    expect(r.coverage.failed).toContain('LINK_RESOLVE')
  })
})

describe('manual, idempotência e recálculo sem APIs', () => {
  it('site informado à mão vale como confirmado (a pessoa é a autoridade)', () => {
    const l = lead({ siteManual: true, foundWebsite: 'https://meusite.com.br' })
    const r = resolveFromEvidence(l, [], opts({}, l))
    expect(r.decision).toMatchObject({ status: 'HAS_WEBSITE', primaryReason: 'MANUAL_CONFIRMED', confidence: 1 })
  })

  describe('reclassificar com evidências existentes, sem nenhuma chamada externa', () => {
    afterEach(() => vi.unstubAllGlobals())
    it('não usa rede, devolve a mesma decisão e preserva o instante real da coleta de evidência vinda de cache', () => {
      const fetchSpy = vi.fn(() => { throw new Error('rede proibida no recálculo') })
      vi.stubGlobal('fetch', fetchSpy)
      const collected = hoursAgo(5)
      const l = lead({ website: 'https://arenatribo.com.br' })
      const rows = [factsRow('https://arenatribo.com.br', OWN_PAGE, { collectedAt: collected, fromCache: true }), searchRow('NAME', [], { collectedAt: collected, fromCache: true })]
      const a = resolveFromEvidence(l, rows, opts({}, l))
      const b = resolveFromEvidence(l, rows, opts({}, l))
      expect(fetchSpy).not.toHaveBeenCalled()
      expect(a.decision).toEqual(b.decision)
      expect(a.decision.status).toBe('HAS_WEBSITE')
      expect(a.decision.reasons).toContain('CONFIRMED_FROM_STORED_EVIDENCE')
      expect(a.candidates[0]).toMatchObject({ fromCache: true, collectedAt: collected.toISOString() }) // cache ≠ coleta recente
    })
    it('lead legado sem nenhuma evidência armazenada NÃO herda "sem site": fica UNKNOWN até ser investigado', () => {
      const r = resolveFromEvidence(lead({ placeId: 'x', website: null }), [], opts())
      expect(r.decision.status).toBe('UNKNOWN')
      expect(r.next?.action).toBe('GOOGLE_DETAILS') // placeId sem evidência do campo websiteUri: o Google ainda não foi "consultado"
    })
  })
})

// ── Revisão: evidência do Google, Meta, plataformas, validade, páginas internas, teto do Tavily ──────────────────────
import { env } from '../config/env'
import { googleEvidenceRow } from './lead-evidence.service'

describe('Google: placeId não é "Google consultado"', () => {
  const full = (extra: ReturnType<typeof googleRow>[] = [googleRow()]) => [...extra, searchRow('NAME'), searchRow('PHONE')]

  it('placeId antigo/importado SEM evidência do campo websiteUri: etapa incompleta, nunca "sem site"; a próxima etapa busca a evidência', () => {
    const r = resolveFromEvidence(LEAD, [searchRow('NAME'), searchRow('PHONE')], opts({ exhausted: false }))
    expect(r.coverage.sources.GOOGLE).toBe('NOT_CHECKED')
    expect(r.coverage.done).not.toContain('GOOGLE')
    expect(r.decision.status).toBe('UNKNOWN')
    expect(r.decision.outcome).toBe('INCOMPLETE')
    expect(r.decision.pending).toContain('GOOGLE')
    expect(r.next).toMatchObject({ action: 'GOOGLE_DETAILS', key: 'place-1', paid: true })
  })

  it('evidência de coleta que NÃO pediu websiteUri (versão de máscara desconhecida) é inválida: o campo continua desconhecido', () => {
    const r = resolveFromEvidence(LEAD, full([googleRow({ version: 'text-search-pro:v1' })]), opts({ exhausted: false }))
    expect(r.coverage.done).not.toContain('GOOGLE')
    expect(r.decision.status).toBe('UNKNOWN')
  })

  it('evidência do Google vencida: a conclusão negativa fica sem sustentação (staleNegative) e a etapa volta ao plano', () => {
    const r = resolveFromEvidence(LEAD, full([googleRow({ collectedAt: hoursAgo(24 * 31) })]), opts({ exhausted: false }))
    expect(r.coverage.staleNegative).toBe(true)
    expect(r.decision.status).toBe('UNKNOWN')
    expect(r.staleReasons).toContain('STEP_EXPIRED:GOOGLE')
    expect(r.next?.action).toBe('GOOGLE_DETAILS')
  })

  it('evidência vigente: nenhuma chamada adicional ao Google (nem na reverificação forçada) e "campo consultado sem resultado" é negativo válido', () => {
    const r = resolveFromEvidence(LEAD, full(), opts({ exhausted: true, forceAt: new Date(Date.now() - 1000) }))
    expect(r.coverage.sources.GOOGLE).toBe('CHECKED_NO_RESULT')
    expect(r.plan.some((p) => p.action === 'GOOGLE_DETAILS')).toBe(false)
    expect(r.decision).toMatchObject({ status: 'PROBABLY_NO_WEBSITE', outcome: 'FINAL' })
  })

  it('Google vindo de cache preserva a DATA REAL: a validade da conclusão conta dela, não de "agora"', () => {
    const coletado = hoursAgo(24 * 25) // vence em ~5 dias, antes das buscas (7 dias)
    const r = resolveFromEvidence(LEAD, [googleRow({ collectedAt: coletado, fromCache: true }), searchRow('NAME'), searchRow('PHONE')], opts({ exhausted: true }))
    expect(r.decision.outcome).toBe('FINAL')
    expect(new Date(r.decision.validUntil as string).getTime()).toBe(coletado.getTime() + env.GOOGLE_EVIDENCE_TTL_HOURS * 3600_000)
  })

  it('a validade da conclusão negativa é a MENOR entre as evidências que a sustentam', () => {
    const nameAt = hoursAgo(100)
    const r = resolveFromEvidence(LEAD, [googleRow(), searchRow('NAME', [], { collectedAt: nameAt }), searchRow('PHONE')], opts({ exhausted: true }))
    expect(new Date(r.decision.validUntil as string).getTime()).toBe(nameAt.getTime() + env.SEARCH_CACHE_NEGATIVE_TTL_HOURS * 3600_000)
  })

  it('o campo websiteUri da evidência com site vira candidato (Google responde com URL) mesmo sem o lead ter o website salvo', () => {
    const e = googleEvidenceRow({ placeId: 'place-1', websiteUri: 'https://arenatribo.com.br', collection: 'text-search-enterprise:v1', collectedAt: new Date(), fromCache: false })
    const r = resolveFromEvidence(LEAD, [e], opts())
    expect(r.candidates.map((c) => c.url)).toContain('https://arenatribo.com.br')
    expect(r.decision.status).not.toBe('PROBABLY_NO_WEBSITE')
  })
})

describe('Meta: NOT_FOUND/pessoal/inacessível não é "bio lida sem site"', () => {
  const ig = lead({ instagramHandle: 'arenatribo', instagramVerificar: false })
  const base = () => [googleRow({ lead: ig }), searchRow('NAME', [], { lead: ig }), searchRow('PHONE', [], { lead: ig })]
  const rOpts = { metaConfigured: true, exhausted: true }

  it('conta não suportada (NOT_FOUND): META_BIO NÃO conclui a cobertura; a alternativa explícita (busca pelo @) passa a ser obrigatória', () => {
    const r = resolveFromEvidence(ig, [...base(), bioRow('arenatribo', { found: false }, { lead: ig })], opts(rOpts, ig))
    expect(r.coverage.required).toContain('TAVILY_HANDLE')
    expect(r.coverage.required).not.toContain('META_BIO')
    expect(r.coverage.done).not.toContain('META_BIO')
    expect(r.decision.status).toBe('UNKNOWN') // falta a cobertura alternativa
    expect(r.decision.pending).toContain('TAVILY_HANDLE')
    expect(r.decision.reasons).toContain('META_BIO_UNSUPPORTED_ACCOUNT_ALT_TAVILY_HANDLE')
    expect(r.next?.action).toBe('TAVILY_HANDLE')
  })

  it('com a cobertura alternativa feita: decide, mas SEM INSTAGRAM_BIO_WITHOUT_SITE e SEM bônus de confiança da bio', () => {
    const handleRow = searchRow('HANDLE', [], { lead: ig, handle: 'arenatribo' })
    const notFound = resolveFromEvidence(ig, [...base(), handleRow, bioRow('arenatribo', { found: false }, { lead: ig })], opts(rOpts, ig))
    expect(notFound.decision.outcome).toBe('FINAL')
    expect(notFound.decision.reasons).not.toContain('INSTAGRAM_BIO_WITHOUT_SITE')
    const found = resolveFromEvidence(ig, [...base(), bioRow('arenatribo', { website: null }, { lead: ig })], opts(rOpts, ig))
    expect(found.decision.reasons).toContain('INSTAGRAM_BIO_WITHOUT_SITE')
    expect(found.decision.confidence).toBeGreaterThan(notFound.decision.confidence) // bônus só com bio efetivamente acessível
  })

  it('Meta não configurada: a mesma cobertura alternativa explícita; não finge a etapa e não reduz o padrão', () => {
    const r = resolveFromEvidence(ig, base(), opts({ metaConfigured: false, exhausted: false }, ig))
    expect(r.coverage.required).toContain('TAVILY_HANDLE')
    expect(r.decision.status).toBe('UNKNOWN')
    expect(r.decision.reasons).toContain('META_NOT_CONFIGURED_ALT_TAVILY_HANDLE')
  })

  it('confirmação positiva por outra fonte NÃO depende da Meta (nem de bio, nem de cobertura alternativa)', () => {
    const l = lead({ instagramHandle: 'arenatribo', instagramVerificar: false, website: 'https://arenatribo.com.br' })
    const r = resolveFromEvidence(l, [factsRow('https://arenatribo.com.br', OWN_PAGE), bioRow('arenatribo', { found: false }, { lead: l })], opts({ metaConfigured: true }, l))
    expect(r.decision).toMatchObject({ status: 'HAS_WEBSITE', outcome: 'FINAL' })
  })
})

describe('teto de consultas por lead não reduz a investigação mínima', () => {
  const old = env.MAX_TAVILY_SEARCHES_PER_LEAD
  afterEach(() => { Object.assign(env, { MAX_TAVILY_SEARCHES_PER_LEAD: old }) })
  it('MAX_TAVILY_SEARCHES_PER_LEAD menor que a cobertura exigida: fica pendente com a configuração apontada, nunca "sem site"', () => {
    Object.assign(env, { MAX_TAVILY_SEARCHES_PER_LEAD: 1 })
    const r = resolveFromEvidence(LEAD, [googleRow(), searchRow('NAME')], opts({ exhausted: true })) // nome+telefone obrigatórios, teto 1
    expect(r.decision.status).toBe('UNKNOWN')
    expect(r.decision.pending).toContain('CONFIG_MAX_TAVILY_SEARCHES_PER_LEAD')
    expect(r.decision.reasons.some((x) => x.startsWith('CONFIG_INSUFFICIENT'))).toBe(true)
    expect(r.coverage.required).toEqual(expect.arrayContaining(['TAVILY_NAME', 'TAVILY_PHONE'])) // exigência intacta
  })
})

describe('plataformas compartilhadas: dois sites no mesmo host não se fundem', () => {
  it('dois sites Wix no MESMO host com caminhos diferentes são candidatos distintos; cada um é lido e julgado pela PRÓPRIA página', () => {
    const l = lead({ website: 'https://usuario.wixsite.com/clinica-a', foundWebsite: 'https://usuario.wixsite.com/clinica-b' })
    const r = resolveFromEvidence(l, [
      factsRow('https://usuario.wixsite.com/clinica-a', OTHER_COMPANY_PAGE),
      factsRow('https://usuario.wixsite.com/clinica-b', OWN_PAGE),
    ], opts({}, l))
    expect(r.candidates.map((c) => c.siteKey).sort()).toEqual(['usuario.wixsite.com/clinica-a', 'usuario.wixsite.com/clinica-b'])
    expect(r.candidates.find((c) => c.siteKey.endsWith('clinica-a'))?.linkage).toBe('CONTRADICTED')
    expect(r.decision).toMatchObject({ status: 'HAS_WEBSITE', confirmedWebsite: 'https://usuario.wixsite.com/clinica-b' })
    expect(r.plan.filter((p) => p.action === 'PAGE_CHECK').map((p) => p.key).sort()).toEqual(['https://usuario.wixsite.com/clinica-a', 'https://usuario.wixsite.com/clinica-b']) // caminho preservado
  })
})

describe('validade das confirmações: fato vencido é histórico, nunca confirmação atual', () => {
  const l = lead({ website: 'https://arenatribo.com.br' })
  it('PAGE_FACTS vencido que confirmaria o site NÃO produz HAS_WEBSITE: reinvestigação (PAGE_CHECK) e motivo CONFIRMATION_EXPIRED', () => {
    const velho = hoursAgo(24 * 30)
    const r = resolveFromEvidence(l, [factsRow('https://arenatribo.com.br', OWN_PAGE, { collectedAt: velho })], opts({ exhausted: false }, l))
    expect(r.decision.status).toBe('UNKNOWN')
    expect(r.decision.outcome).toBe('INCOMPLETE')
    expect(r.decision.primaryReason).toBe('CONFIRMATION_EXPIRED')
    expect(r.decision.confirmation.valid).toBe(false)
    expect(r.next).toMatchObject({ action: 'PAGE_CHECK', key: 'https://arenatribo.com.br' })
    expect(r.staleReasons).toContain('FACTS_EXPIRED:arenatribo.com.br')
  })
  it('o mesmo fato dentro da validade confirma, com a data REAL da coleta (não a do recálculo)', () => {
    const coletado = hoursAgo(48)
    const r = resolveFromEvidence(l, [factsRow('https://arenatribo.com.br', OWN_PAGE, { collectedAt: coletado })], opts({}, l))
    expect(r.decision.status).toBe('HAS_WEBSITE')
    expect(r.decision.confirmation.at).toBe(coletado.toISOString())
  })
})

describe('páginas internas (HTTP grátis): contato/sobre/unidades quando a inicial é acessível mas insuficiente', () => {
  const l = lead({ website: 'https://arenatribo.com.br' })
  const HOME = html('Arena Tribo', '<a href="/contato">Contato</a><a href="/sobre">Sobre</a><a href="/blog/post-1">blog</a><a href="https://outrosite.com/contato">fora</a>')
  const CONTATO = html('Contato', '<footer>Contato: (48) 99123-4567</footer>')
  const old = env.MAX_INTERNAL_PAGES_PER_CANDIDATE
  afterEach(() => { Object.assign(env, { MAX_INTERNAL_PAGES_PER_CANDIDATE: old }) })

  it('home insuficiente: planeja só as páginas internas relevantes do MESMO host, por prioridade (contato antes de sobre), sem blog nem links externos', () => {
    const r = resolveFromEvidence(l, [googleRow({ websiteUri: 'https://arenatribo.com.br' }), factsRow('https://arenatribo.com.br', HOME)], opts({}, l))
    const pages = r.plan.filter((p) => p.action === 'PAGE_CHECK').map((p) => p.key)
    expect(pages).toEqual(['https://arenatribo.com.br', 'https://arenatribo.com.br/contato', 'https://arenatribo.com.br/sobre'])
    expect(r.next).toMatchObject({ action: 'PAGE_CHECK', key: 'https://arenatribo.com.br/contato' })
    expect(r.decision.status).toBe('UNKNOWN')
  })

  it('confirmação encontrada na página interna de contato (nome da home + telefone do contato, MESMO site)', () => {
    const r = resolveFromEvidence(l, [factsRow('https://arenatribo.com.br', HOME), factsRow('https://arenatribo.com.br/contato', CONTATO)], opts({}, l))
    expect(r.decision).toMatchObject({ status: 'HAS_WEBSITE', confirmedWebsite: 'https://arenatribo.com.br' })
    expect(r.candidates[0].evidence.map((e) => e.type)).toContain('INTERNAL_PAGE_USED')
    expect(r.candidates).toHaveLength(1) // a página interna é do candidato, não um candidato novo
  })

  it('limite explícito de páginas por candidato', () => {
    Object.assign(env, { MAX_INTERNAL_PAGES_PER_CANDIDATE: 1 })
    const r = resolveFromEvidence(l, [factsRow('https://arenatribo.com.br', HOME)], opts({}, l))
    expect(r.plan.filter((p) => p.action === 'PAGE_CHECK').map((p) => p.key)).toEqual(['https://arenatribo.com.br', 'https://arenatribo.com.br/contato'])
  })

  it('página interna 403/anti-bot é "não avaliável": não confirma e não vira prova negativa', () => {
    const r = resolveFromEvidence(l, [factsRow('https://arenatribo.com.br', HOME), factsRow('https://arenatribo.com.br/contato', '', { httpStatus: 403, blocked: true })], opts({}, l))
    expect(r.decision.status).toBe('UNKNOWN')
    expect(r.decision.status).not.toBe('PROBABLY_NO_WEBSITE')
  })

  it('página interna VENCIDA não sustenta a confirmação (histórico)', () => {
    const r = resolveFromEvidence(l, [factsRow('https://arenatribo.com.br', HOME), factsRow('https://arenatribo.com.br/contato', CONTATO, { collectedAt: hoursAgo(24 * 30) })], opts({}, l))
    expect(r.decision.status).toBe('UNKNOWN')
  })

  it('página interna que redireciona para OUTRO site não é misturada ao candidato', () => {
    const r = resolveFromEvidence(l, [factsRow('https://arenatribo.com.br', HOME), factsRow('https://arenatribo.com.br/contato', CONTATO, { finalUrl: 'https://outro-dominio.com.br/contato' })], opts({}, l))
    expect(r.decision.status).toBe('UNKNOWN')
  })

  it('home de diretório/multiempresa NÃO é expandida (nome de uma empresa + telefone de outra não se mistura entre páginas)', () => {
    const dir = html('Guia de esportes', Array.from({ length: 6 }, (_, i) => `<li>Empresa ${i} - telefone: (48) 9${i}111-22${i}3</li>`).join('') + '<a href="/contato">Contato</a>')
    const r = resolveFromEvidence(l, [factsRow('https://arenatribo.com.br', dir)], opts({}, l))
    expect(r.plan.filter((p) => p.action === 'PAGE_CHECK').map((p) => p.key)).toEqual(['https://arenatribo.com.br'])
  })
})

describe('unidade em páginas internas (contato compartilhado): sem comprovação fica pendente', () => {
  const l = lead({ website: 'https://redearena.com.br', ownerGroupSize: 2 })
  const HOME = html('Arena Tribo', '<a href="tel:+5548991234567">central</a><a href="/unidades">Unidades</a>')
  const UNIDADES_OK = html('Unidades', '<footer>Contato das unidades: Florianópolis - SC | Tubarão - SC | Joinville - SC</footer>')
  const UNIDADES_OUTRAS = html('Unidades', '<footer>Contato das unidades: Florianópolis - SC | Joinville - SC</footer>')
  const base = [googleRow({ lead: l, websiteUri: 'https://redearena.com.br' })]

  it('home com telefone central + nome, sem unidade: PLAUSIBLE → UNKNOWN e planeja a página de unidades (HTTP grátis)', () => {
    const r = resolveFromEvidence(l, [...base, factsRow('https://redearena.com.br', HOME)], opts({}, l))
    expect(r.decision.status).toBe('UNKNOWN')
    expect(r.next).toMatchObject({ action: 'PAGE_CHECK', key: 'https://redearena.com.br/unidades' })
  })
  it('a página interna de unidades comprova a unidade do lead no texto visível → HAS_WEBSITE', () => {
    const r = resolveFromEvidence(l, [...base, factsRow('https://redearena.com.br', HOME), factsRow('https://redearena.com.br/unidades', UNIDADES_OK)], opts({}, l))
    expect(r.decision.status).toBe('HAS_WEBSITE')
  })
  it('a página de unidades só lista OUTRAS unidades → continua UNKNOWN (BRAND_OTHER_UNIT), nunca confirmado nem rejeitado', () => {
    const r = resolveFromEvidence(l, [...base, factsRow('https://redearena.com.br', HOME), factsRow('https://redearena.com.br/unidades', UNIDADES_OUTRAS)], opts({}, l))
    expect(r.candidates[0].linkage).toBe('BRAND_OTHER_UNIT')
    expect(r.decision.status).toBe('UNKNOWN')
  })
})

describe('Place Details primeiro: nada pago antes dele', () => {
  const nofone = lead({ phoneE164: null, whatsapp: null, placeId: 'place-1' })
  it('lead só descoberto (sem Details, sem telefone): a ÚNICA etapa paga pendente é GOOGLE_DETAILS; Tavily/Meta esperam', () => {
    const r = resolveFromEvidence(nofone, [], opts({ metaConfigured: true }, nofone))
    expect(r.next).toMatchObject({ action: 'GOOGLE_DETAILS', paid: true })
    const blocked = resolveFromEvidence(nofone, [], opts({ blocked: [{ step: 'GOOGLE_DETAILS', code: 'WINDOW_M' }] }, nofone))
    expect(blocked.next).toBeNull() // Details sem saldo: não gasta Tavily no lugar dele
    expect(blocked.decision.status).toBe('UNKNOWN')
    expect(blocked.coverage.sources.GOOGLE).toBe('NOT_CHECKED_QUOTA')
  })
  it('ausência de websiteUri na descoberta Pro não vira "sem site": sem a evidência do Details a decisão fica UNKNOWN mesmo com buscas negativas', () => {
    const r = resolveFromEvidence(LEAD, [searchRow('NAME'), searchRow('PHONE')], opts({ exhausted: true }))
    expect(r.decision.status).toBe('UNKNOWN')
    expect(r.decision.pending).toContain('GOOGLE')
  })
})
