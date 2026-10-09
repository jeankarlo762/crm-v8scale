// Monta candidatos, cobertura e PLANO a partir das evidências já armazenadas e devolve a decisão. NÃO faz rede nem
// toca no banco: é o que permite reclassificar a base inteira (dry-run) só com evidências guardadas.
// Quem executa as etapas do plano (HTTP grátis, Meta, Tavily) é investigation.service.
import { env } from '../config/env'
import { fold, leadPhoneCanon, phonesInText, canonicalBrPhone, parseLeadAddress } from './contact-normalize'
import { classifyUrl, candidateBase, isCandidateSiteKind, siteKeyOf, type UrlKind } from './url-classify.service'
import { distinctiveTokens, matchIdentity, type IdentityLead, type Linkage } from './website-identity.service'
import { mergePageFacts, type PageFacts } from './page-facts.service'
import { decideWebsite, type Coverage, type DecisionCandidate, type DecisionSource, type QueryRecord, type RequiredStep, type WebsiteDecision } from './website-decision.service'
import type { NextAction, SourceState } from './website-types'
import { rowId, rowState, ttlMs, type EvidenceRow, type GoogleFieldValue } from './lead-evidence.service'
import { extractFromResults, extractSiteByHandle, type SearchResult } from './search-enrich.service'
import { rejectFoundSite } from './found-site-rules.service'
import { domainRelatesToBusiness, registrableDomain } from './domain-classifier.service'

export interface ResolveLead extends IdentityLead {
  placeId?: string | null
  website: string | null // websiteUri do Google
  instagramVerificar?: boolean
  instagramManual?: boolean
  siteManual?: boolean
  foundWebsite: string | null
  foundWebsiteSource?: string | null
  confirmedWebsite?: string | null
  websiteConfirmation?: { url?: string | null } | null
  ownerGroupSize?: number
}

export interface ResolveOptions {
  now?: Date
  dependsOn: string
  tavilyConfigured: boolean
  metaConfigured: boolean
  googleConfigured?: boolean // Place Details disponível (chave real, sem mock); false → a etapa GOOGLE pendente não é executável
  forceAt?: Date | null // reverificar: etapas coletadas antes deste instante contam como NÃO feitas (ainda sujeitas a orçamento)
  attempted?: string[] // etapas já tentadas nesta rodada e que falharam (não repetir no loop)
  blocked?: { step: string; code: string }[] // etapas bloqueadas agora (cota/rate limit/erro/auth)
  exhausted?: boolean
}

export interface PlanStep { action: NextAction; key: string; paid: boolean; provider: 'GOOGLE' | 'TAVILY' | 'META' | 'HTTP'; required: boolean; done: boolean }

export interface Resolution {
  decision: WebsiteDecision
  candidates: DecisionCandidate[]
  coverage: Coverage
  plan: PlanStep[]
  next: PlanStep | null // próxima etapa pendente (ordem: grátis → Meta → Tavily)
  derived: { instagramHandle: string | null; instagramVerificar: boolean; foundWebsite: string | null; foundWebsiteVerificar: boolean; foundSiteStatus: string | null; foundSiteCheckReason: string | null; foundWebsiteSource: string | null }
  staleReasons: string[]
}

const MAX_CANDIDATES = 6
const MAX_LINK_CANDIDATES = 5
export const linkageRank: Record<Linkage, number> = { CONFIRMED: 5, PLAUSIBLE: 4, BRAND_OTHER_UNIT: 3, INCONCLUSIVE: 2, NOT_EVALUABLE: 1, CONTRADICTED: 0 }

export function normUrl(u: string | null | undefined): string | null { return classifyUrl(u).url }

// Consultas por tipo, da mais discriminante para a menos: nome+cidade+UF, telefone, @, endereço.
export function queryFor(kind: 'NAME' | 'PHONE' | 'HANDLE' | 'ADDRESS' | 'INSTAGRAM', lead: Pick<ResolveLead, 'arenaName' | 'city' | 'state' | 'address' | 'phoneE164' | 'whatsapp'>, handle?: string | null): string | null {
  const uf = (lead.state ?? '').trim().toUpperCase().slice(0, 2)
  const loc = [lead.city, uf].filter(Boolean).join(' ')
  const clean = (s: string) => s.replace(/\s+/g, ' ').trim()
  if (kind === 'NAME') return clean(`${lead.arenaName} ${loc}`)
  if (kind === 'PHONE') { const p = leadPhoneCanon(lead); return p ? clean(`"${lead.arenaName}" ${p.length === 11 ? `(${p.slice(0, 2)}) ${p.slice(2, 7)}-${p.slice(7)}` : `(${p.slice(0, 2)}) ${p.slice(2, 6)}-${p.slice(6)}`}`) : null }
  if (kind === 'HANDLE') return handle ? `"${handle}"` : null
  if (kind === 'ADDRESS') { const a = parseLeadAddress(lead.address); return a.street && a.number ? clean(`${lead.arenaName} ${a.street} ${a.number} ${loc}`) : null }
  return clean(`${lead.arenaName} instagram ${loc}`)
}

interface Row<T = unknown> extends EvidenceRow { value: T; state: ReturnType<typeof rowState> }
type SearchValue = { kind: 'NAME' | 'PHONE' | 'HANDLE' | 'ADDRESS' | 'INSTAGRAM'; query: string; results: SearchResult[] }
type BioValue = { found: boolean; website: string | null; biography: string | null; username: string | null }
type LinkValue = { ok?: boolean; links: string[]; instagram: string | null }

const handleRelates = (handle: string, name: string) => { const t = distinctiveTokens(name); const h = handle.toLowerCase().replace(/[^a-z0-9]/g, ''); return t.length > 0 && t.every((x) => h.includes(x)) }

export function resolveFromEvidence(lead: ResolveLead, allRows: EvidenceRow[], opts: ResolveOptions): Resolution {
  const now = opts.now ?? new Date()
  const rows: Row[] = allRows.map((r) => ({ ...r, state: rowState(r, opts.dependsOn, now) })).filter((r) => r.state !== 'INVALID')
  const staleReasons: string[] = []
  const byType = (t: EvidenceRow['type']) => rows.filter((r) => r.type === t)
  const factsOf = (url: string): Row<PageFacts> | undefined => rows.find((r) => r.type === 'PAGE_FACTS' && r.key === url) as Row<PageFacts> | undefined
  const fresh = (r: Row | undefined): boolean => !!r && r.state === 'FRESH' && !(opts.forceAt && r.collectedAt < opts.forceAt)
  const loc = { city: lead.city, state: lead.state, address: lead.address, addressComponents: lead.addressComponents }

  // ── Instagram: do lead, descoberto pela busca ou pela página de bio ──────────────────────────
  let handle = lead.instagramHandle ?? null
  let verificar = !!lead.instagramVerificar && !lead.instagramManual
  const searchRows = byType('SEARCH_RESULTS') as Row<SearchValue>[]
  const urlSources = new Map<string, DecisionSource>()
  const addUrl = (raw: string | null | undefined, source: DecisionSource) => { const u = normUrl(raw); if (u && !urlSources.has(u)) urlSources.set(u, source) }
  const linkPages: { url: string; source: DecisionSource }[] = []
  const searchCandidates: string[] = []
  let bioUrlFromSearch: string | null = null
  for (const r of searchRows) {
    const v = r.value
    if (v.kind === 'HANDLE' && handle) {
      const s = extractSiteByHandle(v.results, lead.arenaName, handle, loc)
      if (s) searchCandidates.push(s.foundWebsite)
      continue
    }
    const ex = extractFromResults(v.results, lead.arenaName, loc, handle, lead.phoneE164 ?? lead.whatsapp)
    for (const c of ex.candidates ?? []) searchCandidates.push(c.origin)
    bioUrlFromSearch ??= ex.bioUrl
    if (!handle && ex.instagramHandle) { handle = ex.instagramHandle; verificar = ex.instagramVerificar }
  }

  // ── Google ───────────────────────────────────────────────────────────────────────────────
  // placeId NÃO prova consulta recente nem FieldMask com websiteUri: só a linha PLACE_FIELDS (data real da resposta, versão da
  // coleta, resultado do campo) vigente conta como "Google consultado". Sem ela o campo é DESCONHECIDO, nunca "sem site".
  const googleRow = lead.placeId ? (byType('PLACE_FIELDS') as Row<GoogleFieldValue>[]).find((r) => r.key === lead.placeId) : undefined
  const googleFresh = !!googleRow && googleRow.state === 'FRESH'
  const googleBlocked = opts.blocked?.find((b) => b.step === 'GOOGLE_DETAILS')
  const gUrl = lead.website ?? (googleFresh ? googleRow?.value.websiteUri ?? null : null)
  const g = classifyUrl(gUrl)
  let googleSocial = false
  if (isCandidateSiteKind(g.kind)) addUrl(g.url, 'GOOGLE')
  else if (g.kind === 'LINK_IN_BIO' && g.url) linkPages.push({ url: g.url, source: 'GOOGLE' })
  else if (g.kind === 'INSTAGRAM' || g.kind === 'FACEBOOK' || g.kind === 'WHATSAPP') googleSocial = true
  if (g.kind === 'INSTAGRAM' && g.url && !handle) { const m = g.url.match(/instagram\.com\/([a-z0-9._]+)/i); if (m) { handle = m[1].toLowerCase(); verificar = false } }
  const googleState: SourceState = !lead.placeId ? 'NOT_CHECKED'
    : !googleFresh ? (googleBlocked ? stateOfBlock(googleBlocked.code) : opts.googleConfigured === false ? 'NOT_CONFIGURED' : 'NOT_CHECKED')
    : !gUrl ? 'CHECKED_NO_RESULT' : isCandidateSiteKind(g.kind) ? 'CHECKED_WITH_RESULT' : 'CHECKED_RESULTS_DISCARDED'

  // ── Meta (bio do Instagram) ──────────────────────────────────────────────────────────────
  const bioRow = handle ? (byType('IG_BIO') as Row<BioValue>[]).find((r) => r.key === handle!.toLowerCase()) : undefined
  let igCorroborated = false
  if (bioRow?.value.found) {
    const bio = bioRow.value
    const phoneInBio = !!leadPhoneCanon(lead) && (phonesInText(bio.biography ?? '').has(leadPhoneCanon(lead) as string) || [...(bio.biography ?? '').matchAll(/\d{10,13}/g)].some((m) => canonicalBrPhone(m[0]) === leadPhoneCanon(lead)))
    igCorroborated = phoneInBio || handleRelates(bio.username ?? handle ?? '', lead.arenaName)
    const w = classifyUrl(bio.website)
    if (isCandidateSiteKind(w.kind)) addUrl(w.url, 'INSTAGRAM')
    else if (w.kind === 'LINK_IN_BIO' && w.url) linkPages.push({ url: w.url, source: 'INSTAGRAM' })
  }
  if (bioUrlFromSearch) linkPages.push({ url: bioUrlFromSearch, source: 'TAVILY' })

  // ── Link na bio resolvido (HTTP grátis, 1 nível) ─────────────────────────────────────────
  let bioHandle: string | null = null
  const unreadableLinkPages: string[] = []
  for (const lp of linkPages) {
    const url = normUrl(lp.url); if (!url) continue
    const lr = byType('LINK_PAGE').find((r) => r.key === url) as Row<LinkValue> | undefined
    if (!lr) continue
    if (lr.value.ok === false) unreadableLinkPages.push(url)
    if (lr.value.instagram && !handle && !bioHandle) bioHandle = lr.value.instagram
    let n = 0
    for (const l of lr.value.links) {
      const c = classifyUrl(l)
      if (!isCandidateSiteKind(c.kind) || !c.url || rejectFoundSite(c.url, { arenaName: lead.arenaName, city: lead.city, state: lead.state, instagramHandle: handle }, { allowUnrelated: true }) || n >= MAX_LINK_CANDIDATES) continue
      n++; addUrl(candidateBase(c.url) ?? c.url, 'LINK_BIO')
    }
  }
  if (bioHandle) { handle = bioHandle; verificar = true }

  // ── Demais fontes de URL ─────────────────────────────────────────────────────────────────
  if (lead.siteManual) addUrl(lead.foundWebsite, 'MANUAL')
  for (const u of searchCandidates) addUrl(u, 'TAVILY')
  if (!lead.siteManual && lead.foundWebsite) addUrl(lead.foundWebsite, lead.foundWebsiteSource === 'instagram' ? 'INSTAGRAM' : lead.foundWebsiteSource === 'link_na_bio' ? 'LINK_BIO' : 'TAVILY')
  addUrl(lead.websiteConfirmation?.url ?? lead.confirmedWebsite, 'HISTORY') // histórico: só vale se a página confirmar AGORA

  // ── Avalia cada URL com os fatos armazenados ─────────────────────────────────────────────
  const idLead: IdentityLead = { ...lead, instagramHandle: handle, instagramConfirmed: !!handle && (!verificar || igCorroborated), phoneShared: (lead.ownerGroupSize ?? 1) >= 2 }
  const priority: DecisionSource[] = ['MANUAL', 'GOOGLE', 'HISTORY', 'INSTAGRAM', 'LINK_BIO', 'TAVILY']
  const urls = [...urlSources.entries()].sort((a, b) => priority.indexOf(a[1]) - priority.indexOf(b[1])).slice(0, MAX_CANDIDATES)
  const raw: (DecisionCandidate & { facts?: PageFacts; domainRel: boolean; internalToFetch?: string[] })[] = []
  const expiries: number[] = [] // validade de cada evidência de página usada (para a validade da conclusão negativa)
  for (const [url, source] of urls) {
    const c = classifyUrl(url)
    const fr = factsOf(url)
    const originalKey = c.siteKey ?? c.domain ?? url
    if (source === 'MANUAL') {
      raw.push({ url, finalUrl: fr?.value.finalUrl ?? null, siteKey: originalKey, domain: c.domain ?? url, source, kind: c.kind as UrlKind, linkage: 'CONFIRMED', confidence: 1, health: fr?.value.health ?? null, evidence: [{ source: 'MANUAL', type: 'MANUAL_CONFIRMED', value: c.host, confidence: 1 }], collectedAt: fr?.collectedAt.toISOString(), domainRel: true })
      continue
    }
    if (!fr) {
      raw.push({ url, finalUrl: null, siteKey: originalKey, domain: c.domain ?? url, source, kind: c.kind as UrlKind, linkage: 'NOT_EVALUABLE', confidence: 0, health: null, evidence: [{ source: 'WEBSITE', type: 'PAGE_NOT_FETCHED', value: c.host, confidence: 0 }], domainRel: false })
      continue
    }
    const finalKey = siteKeyOf(fr.value.finalUrl) ?? originalKey
    const domain = registrableDomain(new URL(fr.value.finalUrl).hostname)
    if (fr.state === 'EXPIRED') {
      // Fato vencido é HISTÓRICO: nunca produz confirmação atual (nem recalculando sem rede). A página volta a ser lida.
      staleReasons.push(`FACTS_EXPIRED:${c.host}`)
      raw.push({ url, finalUrl: fr.value.finalUrl, siteKey: finalKey, domain, source, kind: c.kind as UrlKind, linkage: 'NOT_EVALUABLE', confidence: 0, health: null, relatedKeys: finalKey !== originalKey ? [originalKey] : [], collectedAt: fr.collectedAt.toISOString(), fromCache: fr.fromCache,
        evidence: [{ source: 'WEBSITE', type: 'PAGE_FACTS_EXPIRED', value: c.host, confidence: 0, at: fr.collectedAt.toISOString() }], domainRel: false })
      continue
    }
    // Páginas internas de contato/sobre/unidades JÁ lidas e vigentes, do MESMO site (nunca de diretório/multiempresa): mesma fonte, mesmo estabelecimento.
    const candidates = fr.value.evaluable && !fr.value.multiBusiness ? (fr.value.internalLinks ?? []).filter((u) => siteKeyOf(u) === finalKey).slice(0, env.MAX_INTERNAL_PAGES_PER_CANDIDATE) : []
    const usable = candidates.map((u) => factsOf(u)).filter((r): r is Row<PageFacts> => !!r && r.state === 'FRESH' && !!r.value.evaluable && siteKeyOf(r.value.finalUrl) === finalKey && !(opts.forceAt && r.collectedAt < opts.forceAt)) // redirect para outro site: não mistura
    const facts = usable.length ? mergePageFacts(fr.value, usable.map((r) => r.value)) : fr.value
    const id = matchIdentity(idLead, facts)
    if (usable.length) for (const r of usable) id.evidence.push({ source: 'WEBSITE', type: 'INTERNAL_PAGE_USED', value: r.key, confidence: 0, at: r.collectedAt.toISOString() })
    const internalToFetch = id.linkage === 'CONFIRMED' || id.linkage === 'CONTRADICTED' ? [] : candidates.filter((u) => !usable.some((r) => r.key === u))
    for (const r of [fr, ...usable]) expiries.push(r.collectedAt.getTime() + ttlMs(r))
    raw.push({
      url, finalUrl: fr.value.finalUrl, siteKey: finalKey, domain, source, kind: c.kind as UrlKind,
      linkage: id.linkage, confidence: id.confidence, health: fr.value.health, evidence: id.evidence, relatedKeys: finalKey !== originalKey ? [originalKey] : [],
      collectedAt: new Date(Math.min(fr.collectedAt.getTime(), ...usable.map((r) => r.collectedAt.getTime()))).toISOString(), fromCache: fr.fromCache && usable.every((r) => r.fromCache), facts, domainRel: domainRelatesToBusiness(c.host ?? '', lead.arenaName, handle), internalToFetch,
    })
  }
  // mesmo destino final (redirect antigo→novo) = mesmo site: funde, ficando com o melhor vínculo
  const merged: typeof raw = []
  for (const c of raw) {
    const m = merged.find((x) => x.siteKey === c.siteKey)
    if (!m) { merged.push(c); continue }
    m.relatedKeys = [...new Set([...(m.relatedKeys ?? []), ...(c.relatedKeys ?? [])])]
    m.evidence = [...m.evidence, ...c.evidence]
    if (linkageRank[c.linkage] > linkageRank[m.linkage]) { m.linkage = c.linkage; m.confidence = c.confidence; m.health = c.health }
  }
  // sites que linkam um para o outro (institucional + reservas) são relacionados, não conflito
  for (const a of merged) for (const b of merged) {
    if (a === b || !a.facts) continue
    if (a.facts.linkHosts.some((h) => { try { return registrableDomain(h) === b.domain } catch { return false } })) a.relatedKeys = [...new Set([...(a.relatedKeys ?? []), b.siteKey])]
  }
  const candidates: DecisionCandidate[] = merged.map(({ facts: _f, domainRel: _d, internalToFetch: _i, ...c }) => c)

  // ── Cobertura ────────────────────────────────────────────────────────────────────────────
  const phone = leadPhoneCanon(lead)
  const mkQuery = (kind: SearchValue['kind']) => queryFor(kind, lead, handle)
  const searchRow = (kind: SearchValue['kind']): Row<SearchValue> | undefined => { const q = mkQuery(kind); return q ? searchRows.find((r) => r.key === fold(q).replace(/\s+/g, ' ').trim()) : undefined }
  const queries: QueryRecord[] = []
  const candByUrl = new Map(raw.map((c) => [c.url, c]))
  for (const r of searchRows) {
    const ex = r.value.kind === 'HANDLE' ? null : extractFromResults(r.value.results, lead.arenaName, loc, handle, lead.phoneE164 ?? lead.whatsapp)
    const urlsHere = [...new Set([...(ex?.candidates ?? []).map((c) => normUrl(c.origin)), ...(r.value.kind === 'HANDLE' && handle ? [normUrl(extractSiteByHandle(r.value.results, lead.arenaName, handle, loc)?.foundWebsite)] : [])].filter((x): x is string => !!x))]
    const unev = urlsHere.filter((u) => { const c = candByUrl.get(u); return !c || c.linkage === 'NOT_EVALUABLE' }).length
    const n = r.value.results.length
    const state: SourceState = n === 0 ? 'CHECKED_NO_RESULT' : urlsHere.length === 0 ? 'CHECKED_RESULTS_DISCARDED' : unev > 0 ? 'CHECKED_CANDIDATES_UNEVALUABLE' : 'CHECKED_WITH_RESULT'
    queries.push({ key: r.value.query, state, results: n, discarded: Math.max(0, n - urlsHere.length), unevaluable: unev, at: r.collectedAt.toISOString(), fromCache: r.fromCache })
  }
  const igConfirmed = !!handle && (!verificar || igCorroborated)
  // Meta só sustenta "bio consultada sem site" com resposta VÁLIDA e bio acessível. Conta inexistente/pessoal/inacessível/não
  // suportada (NOT_FOUND) e Meta não configurada NÃO comprovam ausência de site: a cobertura alternativa EXPLÍCITA é a busca
  // pelo @ (TAVILY_HANDLE) — a etapa META_BIO não é dada como concluída e o padrão de evidência não diminui.
  const bioUsable = !!bioRow && bioRow.state === 'FRESH' && bioRow.value.found
  const bioUnsupported = !!bioRow && bioRow.state === 'FRESH' && !bioRow.value.found
  const metaAlt = igConfirmed && !bioUsable && (!opts.metaConfigured || bioUnsupported)
  const notes: string[] = []
  if (metaAlt) notes.push(bioUnsupported ? 'META_BIO_UNSUPPORTED_ACCOUNT_ALT_TAVILY_HANDLE' : 'META_NOT_CONFIGURED_ALT_TAVILY_HANDLE')
  const required: RequiredStep[] = []
  if (lead.placeId) required.push('GOOGLE')
  // MAX_TAVILY_SEARCHES_PER_LEAD é configuração explícita e NÃO reduz a investigação mínima: se for menor que as consultas
  // obrigatórias, a conclusão negativa fica pendente com a configuração apontada como insuficiente.
  const reqTav: RequiredStep[] = ['TAVILY_NAME', ...(phone ? ['TAVILY_PHONE' as const] : []), ...(metaAlt ? ['TAVILY_HANDLE' as const] : [])]
  required.push(...reqTav)
  if (igConfirmed && !metaAlt) required.push('META_BIO')
  const done: RequiredStep[] = []
  let staleNegative = false
  const doneIf = (step: RequiredStep, row: Row | undefined) => {
    if (!row) return
    if (row.state === 'FRESH' && !(opts.forceAt && row.collectedAt < opts.forceAt)) done.push(step)
    else { staleNegative = true; staleReasons.push(`STEP_EXPIRED:${step}`) }
  }
  if (lead.placeId) {
    // reverificar (forceAt) NÃO refaz o Google: evidência vigente basta e a chamada é paga
    if (googleFresh) done.push('GOOGLE')
    else if (googleRow) { staleNegative = true; staleReasons.push('STEP_EXPIRED:GOOGLE') }
  }
  doneIf('TAVILY_NAME', searchRow('NAME'))
  if (phone) doneIf('TAVILY_PHONE', searchRow('PHONE'))
  if (metaAlt) doneIf('TAVILY_HANDLE', searchRow('HANDLE'))
  else if (igConfirmed) doneIf('META_BIO', bioRow)

  const tavilyState: SourceState = opts.blocked?.some((b) => b.step.startsWith('TAVILY')) ? stateOfBlock(opts.blocked.find((b) => b.step.startsWith('TAVILY'))?.code) : queries.length === 0 ? (opts.tavilyConfigured ? 'NOT_CHECKED' : 'NOT_CONFIGURED') : queries.some((q) => q.state === 'CHECKED_CANDIDATES_UNEVALUABLE') ? 'CHECKED_CANDIDATES_UNEVALUABLE' : queries.some((q) => q.state === 'CHECKED_WITH_RESULT') ? 'CHECKED_WITH_RESULT' : queries.every((q) => q.state === 'CHECKED_NO_RESULT') ? 'CHECKED_NO_RESULT' : 'CHECKED_RESULTS_DISCARDED'
  const igState: SourceState = !igConfirmed ? 'NOT_CHECKED' : opts.blocked?.some((b) => b.step === 'META_BIO') ? stateOfBlock(opts.blocked.find((b) => b.step === 'META_BIO')?.code) : !bioRow ? (opts.metaConfigured ? 'NOT_CHECKED' : 'NOT_CONFIGURED') : !bioRow.value.found ? 'NOT_CHECKED' : bioRow.value.website ? 'CHECKED_WITH_RESULT' : 'CHECKED_NO_RESULT'
  const failed = [...new Set([...(opts.blocked ?? []).map((b) => b.step), ...(unreadableLinkPages.length ? ['LINK_RESOLVE'] : [])])] // link na bio ilegível: não dá pra afirmar que não há site
  // Etapas obrigatórias que NÃO podem rodar (provedor não configurado) também interrompem a conclusão negativa.
  if (!opts.tavilyConfigured) for (const s of ['TAVILY_NAME', 'TAVILY_PHONE', 'TAVILY_HANDLE'] as const) if (required.includes(s) && !done.includes(s) && !failed.includes(s)) failed.push(s)
  if (lead.placeId && !googleFresh && !googleRow && opts.googleConfigured === false && !failed.includes('GOOGLE_DETAILS')) failed.push('GOOGLE_DETAILS')
  if (reqTav.length > env.MAX_TAVILY_SEARCHES_PER_LEAD) { failed.push('CONFIG_MAX_TAVILY_SEARCHES_PER_LEAD'); notes.push(`CONFIG_INSUFFICIENT: MAX_TAVILY_SEARCHES_PER_LEAD=${env.MAX_TAVILY_SEARCHES_PER_LEAD} < ${reqTav.length} consultas obrigatórias`) }

  // Validade da conclusão negativa = a menor validade entre as evidências que a sustentam.
  if (googleFresh) expiries.push(googleRow!.collectedAt.getTime() + ttlMs(googleRow!))
  for (const [step, kind] of [['TAVILY_NAME', 'NAME'], ['TAVILY_PHONE', 'PHONE'], ['TAVILY_HANDLE', 'HANDLE']] as const) { const r = done.includes(step) ? searchRow(kind) : undefined; if (r) expiries.push(r.collectedAt.getTime() + ttlMs(r)) }
  if (done.includes('META_BIO') && bioRow) expiries.push(bioRow.collectedAt.getTime() + ttlMs(bioRow))
  const validUntil = expiries.length ? new Date(Math.min(...expiries)).toISOString() : null

  const coverage: Coverage = { sources: { GOOGLE: googleState, TAVILY: tavilyState, INSTAGRAM: igState }, required, done, failed, queries, staleNegative, exhausted: false, calibrated: false, validUntil, notes }

  // ── Plano ────────────────────────────────────────────────────────────────────────────────
  const plan: PlanStep[] = []
  for (const [url] of urls) {
    const c = candByUrl.get(url)
    if (c && c.source === 'MANUAL') continue
    const fr = factsOf(url)
    plan.push({ action: 'PAGE_CHECK', key: url, paid: false, provider: 'HTTP', required: false, done: fresh(fr) || !!opts.attempted?.includes(`PAGE_CHECK:${url}`) })
  }
  // Página inicial acessível mas insuficiente: poucas páginas internas relevantes, na ordem de prioridade (limite por candidato).
  for (const c of raw) for (const u of c.internalToFetch ?? []) {
    plan.push({ action: 'PAGE_CHECK', key: u, paid: false, provider: 'HTTP', required: false, done: fresh(factsOf(u)) || !!opts.attempted?.includes(`PAGE_CHECK:${u}`) })
  }
  for (const lp of linkPages) {
    const url = normUrl(lp.url); if (!url) continue
    plan.push({ action: 'LINK_RESOLVE', key: url, paid: false, provider: 'HTTP', required: false, done: fresh(byType('LINK_PAGE').find((r) => r.key === url)) || !!opts.attempted?.includes(`LINK_RESOLVE:${url}`) })
  }
  if (lead.placeId && !googleFresh && opts.googleConfigured !== false) plan.push({ action: 'GOOGLE_DETAILS', key: lead.placeId, paid: true, provider: 'GOOGLE', required: true, done: false })
  if (igConfirmed && opts.metaConfigured && !metaAlt) plan.push({ action: 'META_BIO', key: handle!.toLowerCase(), paid: true, provider: 'META', required: true, done: fresh(bioRow) })
  const addTavily = (action: NextAction, kind: SearchValue['kind'], requiredStep: boolean) => {
    const q = mkQuery(kind); if (!q) return
    const row = searchRow(kind)
    plan.push({ action, key: q, paid: true, provider: 'TAVILY', required: requiredStep, done: fresh(row) })
  }
  const maxQ = env.MAX_TAVILY_SEARCHES_PER_LEAD
  const tav: PlanStep[] = []
  const pushT = (action: NextAction, kind: SearchValue['kind'], req: boolean) => { const before = plan.length; addTavily(action, kind, req); if (plan.length > before) tav.push(plan[plan.length - 1]) }
  pushT('TAVILY_NAME', 'NAME', true)
  if (phone) pushT('TAVILY_PHONE', 'PHONE', true)
  if (handle && (!opts.metaConfigured || !igConfirmed || (bioRow && !bioRow.value.found))) pushT('TAVILY_HANDLE', 'HANDLE', metaAlt) // Meta lê a bio mais barato; sem ela, a busca pelo @
  if (!phone) pushT('TAVILY_ADDRESS', 'ADDRESS', false)
  if (!handle) pushT('TAVILY_INSTAGRAM', 'INSTAGRAM', false)
  // teto de consultas por lead: as obrigatórias primeiro, depois as demais até maxQ
  const keep = new Set([...tav.filter((t) => t.required), ...tav.filter((t) => !t.required)].slice(0, maxQ))
  for (let i = plan.length - 1; i >= 0; i--) if (plan[i].provider === 'TAVILY' && !keep.has(plan[i])) plan.splice(i, 1)

  // opcionais só entram se, concluídas as obrigatórias, ainda houver incerteza (decidido abaixo pelo resultado)
  const reqPending = plan.filter((p) => !p.done && (p.required || !p.paid))
  const optional = plan.filter((p) => !p.done && p.paid && !p.required)
  const baseDecision = decideWebsite({ candidates, social: { confirmed: igConfirmed || googleSocial && !!handle, via: igConfirmed ? (lead.instagramManual ? 'MANUAL' : igCorroborated ? 'BIO' : 'SEARCH') : null }, coverage: { ...coverage, exhausted: opts.exhausted ?? false } })
  const positive = baseDecision.status === 'HAS_WEBSITE'
  const blockedSteps = new Set((opts.blocked ?? []).map((b) => b.step))
  const free = reqPending.filter((p) => !p.paid)
  // Enquanto o Place Details (telefone/website do Google) está pendente, NENHUMA outra etapa paga roda: sem ele as consultas por
  // telefone não existem e gastar Tavily/Meta antes só desperdiça cota.
  const googlePending = reqPending.find((p) => p.paid && p.action === 'GOOGLE_DETAILS')
  const paid = googlePending ? [googlePending] : reqPending.filter((p) => p.paid)
  const next: PlanStep | null = positive ? (free[0] ?? null)
    : free[0] ?? paid.find((p) => !blockedSteps.has(p.action)) ?? (!googlePending && baseDecision.status !== 'PROBABLY_NO_WEBSITE' && baseDecision.status !== 'SOCIAL_ONLY' ? optional.find((p) => !blockedSteps.has(p.action)) ?? null : null)

  // derivados para os campos "foundWebsite..." que a UI já usa (nunca sobrescrevem manual)
  const best = [...candidates].filter((c) => c.source !== 'MANUAL' && (c.linkage === 'CONFIRMED' || c.linkage === 'PLAUSIBLE')).sort((a, b) => linkageRank[b.linkage] - linkageRank[a.linkage] || b.confidence - a.confidence)[0]
  const derived = {
    instagramHandle: handle, instagramVerificar: verificar && !igCorroborated,
    foundWebsite: best ? (best.finalUrl ? candidateBase(best.finalUrl) ?? best.url : best.url) : null,
    foundWebsiteVerificar: best ? best.linkage !== 'CONFIRMED' : false,
    foundSiteStatus: best?.health ?? null, foundSiteCheckReason: null,
    foundWebsiteSource: best ? (best.source === 'INSTAGRAM' ? 'instagram' : best.source === 'LINK_BIO' ? 'link_na_bio' : best.source === 'GOOGLE' ? null : 'busca') : null,
  }
  void phone
  return { decision: baseDecision, candidates, coverage, plan, next, derived, staleReasons: [...new Set(staleReasons)] }
}

function stateOfBlock(code?: string): SourceState {
  if (!code) return 'API_ERROR'
  if (code === 'PROVIDER_PAUSED') return 'AUTH_PAUSED'
  if (code === 'NOT_CONFIGURED' || code === 'INVALID_CONFIG' || code === 'ABOVE_DOCUMENTED_CAP') return 'NOT_CONFIGURED'
  if (code === 'RATE_LIMITED') return 'RATE_LIMITED'
  if (code.startsWith('WINDOW_') || code === 'OPERATION_LIMIT' || code === 'RUN_LIMIT' || code === 'PLAN_LIMIT') return 'NOT_CHECKED_QUOTA'
  return 'API_ERROR'
}

export { rowId }
