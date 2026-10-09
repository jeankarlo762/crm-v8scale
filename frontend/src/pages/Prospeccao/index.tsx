import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Search, Sparkles, Target, Plus, X, Check, Upload, AlertTriangle, ChevronLeft, ChevronRight, MapPinned,
} from 'lucide-react'
import { PageHeader } from '../../components/layout/AppLayout'
import { Spinner } from '../../components/ui/Spinner'
import { Button } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Modal'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { cn } from '../../utils/cn'
import { errMsg } from '../../utils/apiError'
import * as leadApi from '../../api/lead.api'
import type { Lead, Nicho, StatusContato, StatusSite, ImportLeadRow, Responsavel, Quota, BuscaRecente, DecisionFilter, ProgressFilter } from '../../api/lead.api'
import { SITE_OPTIONS, SITE_FILTER_DEFAULT, EMPTY_FILTERS, ORDEM_LABEL, compareByOrdem, normalizeSearch, inputClass, selectClass, decisionOf, progressOf, DECISION_OPTIONS, PROGRESS_OPTIONS, type Filters, type Ordem } from './parts/shared'
import { ConsumoPanel } from './parts/ConsumoPanel'
import { ExportMenu } from './parts/ExportMenu'
import { LeadsFilterBar } from './parts/LeadsFilterBar'
import { LeadsTable } from './parts/LeadsTable'
import { LeadDrawer } from './parts/LeadDrawer'
import { BulkActionBar } from './parts/BulkActionBar'

function diasLabel(d: number): string {
  return d === 0 ? 'hoje' : d === 1 ? 'há 1 dia' : `há ${d} dias`
}

type PreviewRow = ImportLeadRow & { include: boolean }

// Prévia da planilha importada — lista editável antes de confirmar. Linhas
// com problema (sem nome da arena ou WhatsApp) vêm desmarcadas por padrão,
// mas o usuário pode corrigir o campo na hora e marcar pra incluir.
function ImportPreviewModal({
  open, rows, totalRows, truncated, onClose, onConfirm, confirming,
}: {
  open: boolean
  rows: PreviewRow[]
  totalRows: number
  truncated: boolean
  onClose: () => void
  onConfirm: (rows: PreviewRow[]) => void
  confirming: boolean
}) {
  const [edited, setEdited] = useState<PreviewRow[]>(rows)

  useEffect(() => { setEdited(rows) }, [rows])

  function updateRow(idx: number, patch: Partial<PreviewRow>) {
    setEdited((prev) => prev.map((r, i) => {
      if (i !== idx) return r
      const next = { ...r, ...patch }
      const warnings: string[] = []
      if (!next.arenaName.trim()) warnings.push('Nome não encontrado')
      if (!next.whatsapp.trim()) warnings.push('WhatsApp não encontrado')
      return { ...next, warnings }
    }))
  }

  const includedCount = edited.filter((r) => r.include).length

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Importar planilha de leads"
      size="xl"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={confirming}>Cancelar</Button>
          <Button onClick={() => onConfirm(edited)} loading={confirming} disabled={includedCount === 0}>
            Importar {includedCount} contato(s)
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-xs text-fg-muted">
          {totalRows} linha(s) encontrada(s){truncated ? ' (limitado às primeiras 5000)' : ''}. Linhas com aviso vêm
          desmarcadas — corrija o campo ou desmarque a linha pra pular na importação. Duplicados por WhatsApp (já
          cadastrados, ou repetidos na própria planilha) são ignorados automaticamente.
        </p>

        <div className="max-h-[55vh] overflow-y-auto border border-border rounded-lg">
          <table className="w-full">
            <thead className="sticky top-0 bg-surface-hover">
              <tr>
                {['', 'Negócio', 'WhatsApp', 'Cidade/UF', 'Contato', ''].map((h) => (
                  <th key={h} className="text-left px-2 py-2 text-[11px] font-semibold text-fg-muted uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {edited.map((row, i) => (
                <tr key={i} className="border-t border-border">
                  <td className="px-2 py-1.5">
                    <input
                      type="checkbox"
                      checked={row.include}
                      onChange={(e) => updateRow(i, { include: e.target.checked })}
                      className="w-4 h-4 rounded accent-orange-500"
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <input
                      value={row.arenaName}
                      onChange={(e) => updateRow(i, { arenaName: e.target.value })}
                      className="w-40 rounded-md border border-border bg-surface px-2 py-1 text-xs text-fg focus:border-orange-400 outline-none"
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <input
                      value={row.whatsapp}
                      onChange={(e) => updateRow(i, { whatsapp: e.target.value })}
                      className="w-32 rounded-md border border-border bg-surface px-2 py-1 text-xs text-fg focus:border-orange-400 outline-none"
                    />
                  </td>
                  <td className="px-2 py-1.5 text-xs text-fg-muted whitespace-nowrap">
                    {[row.city, row.state].filter(Boolean).join(' - ') || '—'}
                  </td>
                  <td className="px-2 py-1.5 text-xs text-fg-muted max-w-[140px] truncate" title={row.contactName ?? ''}>
                    {row.contactName ?? '—'}
                  </td>
                  <td className="px-2 py-1.5">
                    {row.warnings.length > 0 && (
                      <span className="inline-flex items-center gap-1 text-[10px] text-tone-amber-fg" title={row.warnings.join(', ')}>
                        <AlertTriangle size={11} /> {row.warnings.join(', ')}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Modal>
  )
}

export default function ProspeccaoPage() {
  const navigate = useNavigate()
  const [nichos, setNichos] = useState<Nicho[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [loadingNichos, setLoadingNichos] = useState(true)
  const [leads, setLeads] = useState<Lead[]>([])
  const [loadingLeads, setLoadingLeads] = useState(false)

  const [creating, setCreating] = useState(false)
  const [newNome, setNewNome] = useState('')
  const [deletingNicho, setDeletingNicho] = useState<Nicho | null>(null)

  const [cidades, setCidades] = useState('')
  const [buscando, setBuscando] = useState(false)
  const [siteFilter, setSiteFilter] = useState<StatusSite[]>(SITE_FILTER_DEFAULT)
  const [decisionFilter, setDecisionFilter] = useState<DecisionFilter[]>([]) // vazio = todas as decisões
  const [progressFilter, setProgressFilter] = useState<ProgressFilter[]>([]) // vazio = todos os andamentos
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS)
  const [ordem, setOrdem] = useState<Ordem>('prioridade')
  const [enriquecendo, setEnriquecendo] = useState(false)
  const [resumoBusca, setResumoBusca] = useState<{ encontrados: number; details: leadApi.DetailsResumo } | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deletingLead, setDeletingLead] = useState<Lead | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  const [updatingId, setUpdatingId] = useState<string | null>(null)

  const [quota, setQuota] = useState<Quota | null>(null)
  const [repetidas, setRepetidas] = useState<BuscaRecente[] | null>(null)
  const [applyingBulk, setApplyingBulk] = useState(false)
  const [drawer, setDrawer] = useState<{ id: string; focusNotes: boolean } | null>(null)
  const [exporting, setExporting] = useState<'csv' | 'xlsx' | null>(null)
  const [importing, setImporting] = useState(false)
  const [confirmingImport, setConfirmingImport] = useState(false)
  const [preview, setPreview] = useState<{ rows: PreviewRow[]; totalRows: number; truncated: boolean } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  function loadQuota() {
    leadApi.getQuota().then(setQuota).catch(() => {})
  }

  useEffect(() => {
    loadQuota()
    leadApi.listNichos()
      .then((list) => { setNichos(list); setActiveId(list[0]?.id ?? null) })
      .catch(() => toast.error('Erro ao carregar as abas'))
      .finally(() => setLoadingNichos(false))
  }, [])

  async function loadLeads(nichoId: string) {
    setLoadingLeads(true)
    try {
      setLeads(await leadApi.listLeads(nichoId))
    } catch {
      toast.error('Erro ao carregar os leads')
    } finally {
      setLoadingLeads(false)
    }
  }

  useEffect(() => {
    setSiteFilter(SITE_FILTER_DEFAULT)
    setDecisionFilter([])
    setProgressFilter([])
    setFilters(EMPTY_FILTERS)
    setDrawer(null)
    if (activeId) loadLeads(activeId)
    else setLeads([])
  }, [activeId])

  const active = nichos.find((n) => n.id === activeId) ?? null

  async function handleCreateNicho() {
    const nome = newNome.trim()
    if (!nome) return
    try {
      const nicho = await leadApi.createNicho(nome)
      setNichos((prev) => [...prev, nicho])
      setActiveId(nicho.id)
      setNewNome('')
      setCreating(false)
    } catch (err) {
      toast.error(errMsg(err) ?? 'Erro ao criar a aba')
    }
  }

  async function confirmDeleteNicho() {
    if (!deletingNicho) return
    try {
      await leadApi.deleteNicho(deletingNicho.id)
      const rest = nichos.filter((n) => n.id !== deletingNicho.id)
      setNichos(rest)
      if (activeId === deletingNicho.id) setActiveId(rest[0]?.id ?? null)
      toast.success('Aba apagada')
      setDeletingNicho(null)
    } catch (err) {
      toast.error(errMsg(err) ?? 'Erro ao apagar a aba')
    }
  }

  // Antes de gastar cota, avisa se nicho+cidade já foi buscado nos últimos 7 dias.
  // Classificação/enriquecimento rodam em segundo plano: refaz o fetch a cada 5s (por ~2 min)
  // pra os cards atualizarem sozinhos, sem spinner.
  function startPolling(nichoId: string) {
    if (pollRef.current) clearInterval(pollRef.current)
    let ticks = 0
    pollRef.current = setInterval(async () => {
      ticks += 1
      try { setLeads(await leadApi.listLeads(nichoId)) } catch { /* tenta de novo no próximo ciclo */ }
      if (ticks >= 24 && pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
    }, 5000)
  }
  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current) }, [])
  useEffect(() => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null } }, [activeId])

  const [preenchendoUf, setPreenchendoUf] = useState(false)
  async function handlePreencherEstados() {
    setPreenchendoUf(true)
    try {
      const r = await leadApi.preencherEstados()
      toast.success(r.scanned === 0 ? 'Todos os prospects já têm estado' : `Estado preenchido em ${r.filled} de ${r.scanned} prospect(s)${r.unresolved ? ` · ${r.unresolved} sem resposta (cidade com nome repetido ou desconhecida)` : ''}`)
      if (activeId) await loadLeads(activeId)
    } catch (err) {
      toast.error(errMsg(err) ?? 'Erro ao preencher os estados')
    } finally {
      setPreenchendoUf(false)
    }
  }

  async function handleEnriquecer() {
    if (!active) return
    setEnriquecendo(true)
    try {
      const r = await leadApi.enriquecerNicho(active.id)
      if (r.details) setResumoBusca((prev) => ({ encontrados: prev?.encontrados ?? 0, details: r.details as leadApi.DetailsResumo }))
      toast.success(r.buscaConfigurada
        ? `Enriquecendo ${r.enfileirados} lead(s) em segundo plano${r.details ? ` · ${r.details.selecionados} priorizado(s) para telefone/site (Google Details)${r.details.aguardando ? `, ${r.details.aguardando} aguardando` : ''}` : ''}`
        : 'Reverificando sites (busca web desativada: falta TAVILY_API_KEY)')
      startPolling(active.id)
    } catch (err) {
      toast.error(errMsg(err) ?? 'Erro ao enriquecer')
    } finally {
      setEnriquecendo(false)
    }
  }

  async function handleBuscar() {
    if (!active || !cidades.trim()) return
    setBuscando(true)
    try {
      const recentes = await leadApi.buscasRecentes(active.id, cidades)
      if (recentes.length > 0) { setRepetidas(recentes); setBuscando(false); return }
    } catch {
      // se a checagem falhar, segue com a busca normal
    }
    await executarBusca()
  }

  async function executarBusca() {
    if (!active) return
    setRepetidas(null)
    setBuscando(true)
    try {
      const r = await leadApi.buscarLeads(active.id, cidades)
      toast.success(`${r.novos} novo(s) lead(s) · ${r.duplicados} já existiam (${r.atualizados} atualizado(s) com dados do Google)`)
      setResumoBusca(r.details ? { encontrados: r.encontrados, details: r.details } : null)
      await loadLeads(active.id)
      startPolling(active.id)
    } catch (err) {
      toast.error(errMsg(err) ?? 'Erro na busca')
    } finally {
      loadQuota()
      setBuscando(false)
    }
  }

  async function handleLeadUpdate(lead: Lead, data: Parameters<typeof leadApi.updateLead>[1]) {
    setUpdatingId(lead.id)
    try {
      const updated = await leadApi.updateLead(lead.id, data)
      setLeads((prev) => prev.map((l) => (l.id === updated.id ? updated : l)))
    } catch (err) {
      toast.error(errMsg(err) ?? 'Erro ao atualizar o lead')
    } finally {
      setUpdatingId(null)
    }
  }

  async function handleReverificar(lead: Lead) {
    try {
      await leadApi.reverificarLead(lead.id)
      toast.success('Reverificando em segundo plano. Atualize a lista em instantes.')
    } catch (err) {
      toast.error(errMsg(err) ?? 'Erro ao reverificar')
    }
  }

  // Aplica status ou responsável nos selecionados. NÃO limpa a seleção: dá pra aplicar
  // um e depois o outro no mesmo grupo.
  async function convertLead(lead: Lead) {
    if (lead.convertedLeadId) {
      navigate(`/leads?open=${lead.convertedLeadId}`)
      return
    }
    try {
      const r = await leadApi.convertProspect(lead.id)
      toast.success(r.created ? `Lead "${r.name}" criado no funil` : 'Esse prospect já estava no funil')
      if (activeId) await loadLeads(activeId)
      navigate(`/leads?open=${r.leadId}`)
    } catch (err) {
      toast.error(errMsg(err) ?? 'Não foi possível converter em lead')
    }
  }

  async function applyBulk(kind: 'status' | 'responsavel', value: StatusContato | Responsavel | null) {
    if (selected.size === 0 || !active) return
    setApplyingBulk(true)
    try {
      const ids = [...selected]
      const r = kind === 'status'
        ? await leadApi.bulkUpdateStatus(ids, value as StatusContato)
        : await leadApi.bulkUpdateResponsavel(ids, value as Responsavel | null)
      toast.success(`${r.updated} lead(s) atualizado(s)`)
      await loadLeads(active.id)
    } catch (err) {
      toast.error(errMsg(err) ?? 'Erro ao aplicar em massa')
    } finally {
      setApplyingBulk(false)
    }
  }

  // Leva pra Campanha os leads selecionados (até 5000), guardados no sessionStorage porque não cabem na URL.
  // Os filtros atuais seguem na URL só como contexto (nicho/estado/cidade/status).
  function openCampaign() {
    const params = new URLSearchParams()
    try { sessionStorage.setItem('campanha:leadIds', JSON.stringify([...selected].slice(0, 5000))) } catch { /* sem storage: abre sem a seleção */ }
    params.set('selecionados', String(Math.min(selected.size, 5000)))
    if (activeId) params.set('nichoId', activeId)
    if (filters.estado) params.set('estado', filters.estado)
    if (filters.cidade) params.set('cidade', filters.cidade)
    if (filters.contato) params.set('status', filters.contato)
    navigate(`/campanhas?${params.toString()}`)
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setImporting(true)
    try {
      const result = await leadApi.importLeadsPreview(file)
      setPreview({
        totalRows: result.totalRows,
        truncated: result.truncated,
        rows: result.rows.map((r) => ({ ...r, include: r.warnings.length === 0 })),
      })
    } catch (err) {
      toast.error(errMsg(err) ?? 'Erro ao ler a planilha')
    } finally {
      setImporting(false)
    }
  }

  async function handleConfirmImport(rows: PreviewRow[]) {
    if (!active) return
    const toImport = rows.filter((r) => r.include && r.arenaName.trim() && r.whatsapp.trim())
    if (toImport.length === 0) { toast.error('Nenhuma linha válida marcada'); return }
    setConfirmingImport(true)
    try {
      const result = await leadApi.importLeads(active.id, toImport)
      toast.success(`${result.created} lead(s) importado(s)${result.skipped > 0 ? ` (${result.skipped} duplicado(s) pulado(s))` : ''}`)
      setPreview(null)
      await loadLeads(active.id)
    } catch (err) {
      toast.error(errMsg(err) ?? 'Erro ao importar')
    } finally {
      setConfirmingImport(false)
    }
  }

  async function handleExport(format: 'csv' | 'xlsx') {
    if (!active) return
    setExporting(format)
    try {
      await leadApi.exportLeads(active.id, format, {
        statusSite: siteFilter.length < SITE_OPTIONS.length ? siteFilter : undefined,
        status: filters.contato || undefined,
        cidade: filters.cidade || undefined,
        estado: filters.estado || undefined,
        avaliacaoMin: filters.notaMin !== '' ? Number(filters.notaMin) : undefined,
        numAvaliacoesMin: filters.avalMin !== '' ? Number(filters.avalMin) : undefined,
        numAvaliacoesMax: filters.avalMax !== '' ? Number(filters.avalMax) : undefined,
        responsavel: filters.responsavel || undefined,
        somenteCelular: filters.soCelular || undefined,
        decisao: decisionFilter.length ? decisionFilter : undefined,
        andamento: progressFilter.length ? progressFilter : undefined,
      })
    } catch (err) {
      toast.error(errMsg(err) ?? 'Erro ao exportar')
    } finally {
      setExporting(null)
    }
  }

  const estadosDisponiveis = useMemo(
    () => [...new Set(leads.map((l) => l.state).filter((s): s is string => !!s))].sort((a, b) => a.localeCompare(b, 'pt-BR')),
    [leads],
  )

  // Com um estado escolhido, a lista de cidades mostra só as dele.
  const cidadesDisponiveis = useMemo(
    () => [...new Set(leads.filter((l) => !filters.estado || l.state === filters.estado).map((l) => l.city).filter((c): c is string => !!c))].sort((a, b) => a.localeCompare(b, 'pt-BR')),
    [leads, filters.estado],
  )

  // Filtros secundários (tudo menos a presença digital): base dos contadores dos chips.
  const baseFiltered = useMemo(
    () => leads.filter((l) =>
      (!filters.contato || l.status === filters.contato) && (!filters.estado || l.state === filters.estado) && (!filters.cidade || l.city === filters.cidade) &&
      (!filters.responsavel || (filters.responsavel === 'nenhum' ? !l.responsavel : l.responsavel === filters.responsavel)) &&
      (!filters.soCelular || l.phoneMobile === true) &&
      (filters.notaMin === '' || (l.avaliacao != null && l.avaliacao >= Number(filters.notaMin))) &&
      (filters.avalMin === '' || (l.numAvaliacoes != null && l.numAvaliacoes >= Number(filters.avalMin))) &&
      (filters.avalMax === '' || (l.numAvaliacoes != null && l.numAvaliacoes <= Number(filters.avalMax)))),
    [leads, filters],
  )

  const counts = useMemo(() => {
    const c = Object.fromEntries(SITE_OPTIONS.map((s) => [s, 0])) as Record<StatusSite, number>
    for (const l of baseFiltered) c[l.statusSite] += 1
    return c
  }, [baseFiltered])

  // Contadores de decisão e andamento (eixos separados), cada um respeitando o outro filtro e os filtros secundários.
  const decisionCounts = useMemo(() => {
    const c = Object.fromEntries(DECISION_OPTIONS.map((d) => [d, 0])) as Record<DecisionFilter, number>
    for (const l of baseFiltered) if (siteFilter.includes(l.statusSite) && (!progressFilter.length || progressFilter.includes(progressOf(l)))) c[decisionOf(l)] += 1
    return c
  }, [baseFiltered, siteFilter, progressFilter])
  const progressCounts = useMemo(() => {
    const c = Object.fromEntries(PROGRESS_OPTIONS.map((d) => [d, 0])) as Record<ProgressFilter, number>
    for (const l of baseFiltered) if (siteFilter.includes(l.statusSite) && (!decisionFilter.length || decisionFilter.includes(decisionOf(l)))) c[progressOf(l)] += 1
    return c
  }, [baseFiltered, siteFilter, decisionFilter])

  const filtered = useMemo(
    () => baseFiltered
      .filter((l) => siteFilter.includes(l.statusSite) && (!decisionFilter.length || decisionFilter.includes(decisionOf(l))) && (!progressFilter.length || progressFilter.includes(progressOf(l))))
      .sort((a, b) => compareByOrdem(ordem, a, b)),
    [baseFiltered, siteFilter, decisionFilter, progressFilter, ordem],
  )

  // Busca por nome (client-side, sem acento/caixa). Não mexe na seleção: leads marcados e ocultos continuam marcados.
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 200)
    return () => clearTimeout(t)
  }, [searchInput])
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); searchRef.current?.focus(); searchRef.current?.select() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  const searchQ = normalizeSearch(search.trim())
  const visible = useMemo(
    () => (searchQ ? filtered.filter((l) => normalizeSearch(l.arenaName).includes(searchQ)) : filtered),
    [filtered, searchQ],
  )

  const totalPages = Math.max(1, Math.ceil(visible.length / pageSize))
  const currentPage = Math.min(page, totalPages)
  const pageLeads = useMemo(
    () => visible.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [visible, currentPage, pageSize],
  )

  // Filtro, aba ou tamanho de página novos voltam pra primeira página.
  useEffect(() => { setPage(1) }, [siteFilter, decisionFilter, progressFilter, filters, activeId, pageSize, searchQ])

  // Seleção vale só pro conjunto filtrado atual: mudar filtro ou aba limpa, pra nunca
  // excluir um lead que o usuário não está vendo.
  useEffect(() => { setSelected(new Set()) }, [siteFilter, decisionFilter, progressFilter, filters, activeId])

  const pageAllSelected = pageLeads.length > 0 && pageLeads.every((l) => selected.has(l.id))
  const allFilteredSelected = filtered.length > 0 && filtered.every((l) => selected.has(l.id))

  function toggleLead(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  function togglePage() {
    setSelected((prev) => {
      const next = new Set(prev)
      if (pageAllSelected) pageLeads.forEach((l) => next.delete(l.id))
      else pageLeads.forEach((l) => next.add(l.id))
      return next
    })
  }

  async function confirmDelete() {
    const ids = deletingLead ? [deletingLead.id] : [...selected]
    setDeleting(true)
    try {
      const count = await leadApi.deleteLeads(ids)
      const gone = new Set(ids)
      setLeads((prev) => prev.filter((l) => !gone.has(l.id)))
      setSelected((prev) => new Set([...prev].filter((id) => !gone.has(id))))
      setConfirmingDelete(false)
      setDeletingLead(null)
      if (drawer && gone.has(drawer.id)) setDrawer(null)
      toast.success(`${count} lead(s) excluído(s)`)
    } catch (err) {
      toast.error(errMsg(err) ?? 'Erro ao excluir os leads')
    } finally {
      setDeleting(false)
    }
  }

  async function saveNotes(lead: Lead, text: string) {
    await handleLeadUpdate(lead, { notes: text })
  }

  const drawerLead = drawer ? leads.find((l) => l.id === drawer.id) ?? null : null
  const quotaHigh = quota?.limite ? quota.usadas >= quota.limite * 0.9 : false

  return (
    <>
    <PageHeader
      title="Prospecção"
      subtitle="Busque negócios por nicho e cidade e veja quem precisa de um site"
      action={
        <div className="flex items-center gap-1.5 whitespace-nowrap">
          <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleFileChange} />
          {quota && (
            <span className={cn('hidden sm:inline-flex items-center text-xs tabular-nums mr-2', quotaHigh ? 'text-tone-red-fg' : 'text-fg-muted')}>
              {quota.limite != null ? `${quota.usadas.toLocaleString('pt-BR')} de ${quota.limite.toLocaleString('pt-BR')} buscas este mês` : `${quota.usadas.toLocaleString('pt-BR')} buscas este mês · orçamento não configurado`}
            </span>
          )}
          <ConsumoPanel />
          <Button variant="ghost" className="h-9 !py-0" onClick={() => fileInputRef.current?.click()} loading={importing} disabled={!active}>
            <Upload size={15} /> Importar
          </Button>
          <ExportMenu exporting={exporting} disabled={!active || leads.length === 0} onExport={handleExport} />
        </div>
      }
    />
      <div className={cn('flex flex-col gap-4', selected.size > 0 && 'pb-24')}>
        {/* Abas por nicho */}
        <div className="flex flex-wrap items-center gap-2 border-b border-divider pb-3">
          {loadingNichos ? <Spinner size="sm" /> : nichos.map((n) => (
            <div
              key={n.id}
              className={cn('group inline-flex items-center gap-1 rounded-full border text-sm font-medium transition-colors',
                n.id === activeId ? 'bg-orange-500 border-orange-500 text-white' : 'border-border text-fg-muted hover:border-orange-300')}
            >
              <button onClick={() => setActiveId(n.id)} className="pl-3.5 pr-1.5 py-1.5">{n.nome}</button>
              <button
                onClick={() => setDeletingNicho(n)}
                className="pr-2.5 py-1.5 opacity-60 hover:opacity-100"
                title="Apagar aba"
                aria-label={`Apagar aba ${n.nome}`}
              >
                <X size={13} />
              </button>
            </div>
          ))}
          {creating ? (
            <form onSubmit={(e) => { e.preventDefault(); handleCreateNicho() }} className="inline-flex items-center gap-1.5">
              <input
                autoFocus
                value={newNome}
                onChange={(e) => setNewNome(e.target.value)}
                placeholder="Nome do nicho"
                maxLength={80}
                className="text-sm rounded-full border border-orange-300 bg-surface text-fg px-3.5 py-1.5 outline-none focus:ring-2 focus:ring-orange-100 dark:focus:ring-orange-900/30"
              />
              <button type="submit" className="p-1.5 rounded-full bg-orange-500 text-white" title="Criar aba" aria-label="Criar aba"><Check size={14} /></button>
              <button type="button" onClick={() => { setCreating(false); setNewNome('') }} className="p-1.5 rounded-full text-fg-muted hover:text-fg" title="Cancelar" aria-label="Cancelar"><X size={14} /></button>
            </form>
          ) : (
            <button
              onClick={() => setCreating(true)}
              className="inline-flex items-center gap-1 text-sm font-medium px-3.5 py-1.5 rounded-full border border-dashed border-border text-fg-muted hover:border-orange-400 hover:text-orange-600"
            >
              <Plus size={14} /> Nova aba
            </button>
          )}
        </div>

        {!active ? (
          !loadingNichos && (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-fg-muted">
              <Target size={40} className="opacity-40" />
              <p className="text-sm">Crie uma aba com o nicho que você quer prospectar, por exemplo "Clínica de Estética".</p>
            </div>
          )
        ) : (
          <>
            <form onSubmit={(e) => { e.preventDefault(); handleBuscar() }} className="flex flex-col sm:flex-row gap-2">
              <div className="relative flex-1">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted" />
                <input
                  value={cidades}
                  onChange={(e) => setCidades(e.target.value)}
                  placeholder="Cidades separadas por vírgula. Ex: Tubarão, Itajaí - SC"
                  className={cn(inputClass, 'pl-9')}
                />
              </div>
              <button
                type="submit"
                disabled={buscando || !cidades.trim()}
                className="inline-flex items-center justify-center gap-2 text-sm font-semibold rounded-xl px-5 py-2.5 bg-orange-500 hover:bg-orange-600 text-white disabled:bg-border disabled:text-fg-muted disabled:hover:bg-border disabled:cursor-not-allowed"
              >
                {buscando && <Spinner size="sm" />}{buscando ? 'Buscando...' : 'Buscar'}
              </button>
              <button
                type="button"
                onClick={handleEnriquecer}
                disabled={enriquecendo || leads.length === 0}
                title="Retoma o enriquecimento (Google Details) dos leads que ficaram aguardando por limite de orçamento"
                className="inline-flex items-center justify-center gap-2 text-sm font-medium rounded-xl px-4 py-2.5 border border-border text-fg hover:bg-surface-hover disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {enriquecendo ? <Spinner size="sm" /> : <Sparkles size={15} />} Retomar enriquecimento
              </button>
              <button
                type="button"
                onClick={handlePreencherEstados}
                disabled={preenchendoUf}
                title="Descobre a UF dos prospects sem estado pelo endereço do Google ou pela cidade (tabela do IBGE)"
                className="inline-flex items-center justify-center gap-2 text-sm font-medium rounded-xl px-4 py-2.5 border border-border text-fg hover:bg-surface-hover disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {preenchendoUf ? <Spinner size="sm" /> : <MapPinned size={15} />} Preencher estados
              </button>
              <select value={ordem} onChange={(e) => setOrdem(e.target.value as Ordem)} className={selectClass} aria-label="Ordenar por">
                {(Object.keys(ORDEM_LABEL) as Ordem[]).map((o) => <option key={o} value={o}>Ordem: {ORDEM_LABEL[o]}</option>)}
              </select>
            </form>

            {resumoBusca && (() => {
              const d = resumoBusca.details
              const quando = d.motivoEspera === 'SALDO'
                ? d.retomarEm ? `Retomam quando o orçamento renovar, em ${new Date(d.retomarEm).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}.` : 'Retomam quando o orçamento do Google Details for liberado (verifique a configuração).'
                : 'Podem ser retomados agora em "Retomar enriquecimento".'
              return (
                <div role="status" className="rounded-xl border border-border bg-surface px-4 py-3 text-sm text-fg">
                  <p>
                    <strong>{resumoBusca.encontrados}</strong> descoberto(s) · <strong>{d.selecionados}</strong> enriquecido(s) nesta execução (telefone, site e avaliações via Google Details)
                    {d.aguardando > 0 && <> · <strong>{d.aguardando}</strong> aguardando Details por limite de {d.motivoEspera === 'SALDO' ? 'orçamento' : 'lote da execução'}</>}
                  </p>
                  {d.aguardando > 0 && <p className="text-fg-muted mt-1">{quando} Sem Details, o lead fica "sem decisão" e não consome busca web nem Instagram.</p>}
                </div>
              )
            })()}

            <LeadsFilterBar
              siteFilter={siteFilter}
              onSiteFilter={setSiteFilter}
              decisionFilter={decisionFilter}
              onDecisionFilter={setDecisionFilter}
              progressFilter={progressFilter}
              onProgressFilter={setProgressFilter}
              decisionCounts={decisionCounts}
              progressCounts={progressCounts}
              counts={counts}
              total={leads.length}
              filters={filters}
              onFilters={setFilters}
              estados={estadosDisponiveis}
              cidades={cidadesDisponiveis}
              shown={filtered.length}
              pageSize={pageSize}
              onPageSize={setPageSize}
            />

            <div className="flex items-center gap-3">
              <div className="relative flex-1 max-w-md">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted pointer-events-none" />
                <input
                  ref={searchRef}
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Escape') setSearchInput('') }}
                  placeholder="Buscar empresa..."
                  aria-label="Buscar empresa pelo nome"
                  className={cn(inputClass, 'pl-9 pr-9')}
                />
                {searchInput && (
                  <button type="button" onClick={() => { setSearchInput(''); setSearch(''); searchRef.current?.focus() }} aria-label="Limpar busca" className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded text-fg-muted hover:text-fg hover:bg-surface-hover">
                    <X size={14} />
                  </button>
                )}
              </div>
              {searchQ && <span className="text-sm text-fg-muted tabular-nums whitespace-nowrap">{visible.length} de {filtered.length} leads</span>}
            </div>

            <div className="bg-surface rounded-xl border border-border overflow-hidden">
              {loadingLeads ? (
                <div className="flex items-center justify-center py-16 gap-3">
                  <Spinner size="md" />
                  <span className="text-sm text-fg-muted">Carregando leads...</span>
                </div>
              ) : visible.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 gap-3 text-fg-muted">
                  <Target size={40} className="opacity-40" />
                  <p className="text-sm">{searchQ && filtered.length ? `Nenhuma empresa encontrada para '${search.trim()}'` : leads.length ? 'Nenhum lead com esses filtros. Ajuste os chips ou limpe os filtros.' : 'Nenhum lead nessa aba ainda. Busque por uma ou mais cidades.'}</p>
                </div>
              ) : (
                <LeadsTable
                  leads={pageLeads}
                  query={search}
                  selected={selected}
                  pageAllSelected={pageAllSelected}
                  onToggle={toggleLead}
                  onTogglePage={togglePage}
                  updatingId={updatingId}
                  onContato={(lead, status) => handleLeadUpdate(lead, { status })}
                  onResponsavel={(lead, r) => handleLeadUpdate(lead, { responsavel: r })}
                  onOpen={(lead, focusNotes = false) => setDrawer({ id: lead.id, focusNotes })}
                  onReverificar={handleReverificar}
                  onDelete={setDeletingLead}
                />
              )}
              {!loadingLeads && visible.length > pageSize && (
                <div className="flex items-center justify-between gap-3 px-5 py-3 border-t border-border">
                  <p className="text-xs text-fg-muted">
                    {(currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, visible.length)} de {visible.length} · Página {currentPage} de {totalPages}
                  </p>
                  <div className="flex gap-2">
                    <button onClick={() => setPage(currentPage - 1)} disabled={currentPage <= 1} className="inline-flex items-center gap-1 text-sm px-3 py-1.5 rounded-lg border border-border text-fg-muted hover:bg-surface-hover disabled:opacity-40 disabled:cursor-not-allowed">
                      <ChevronLeft size={14} /> Anterior
                    </button>
                    <button onClick={() => setPage(currentPage + 1)} disabled={currentPage >= totalPages} className="inline-flex items-center gap-1 text-sm px-3 py-1.5 rounded-lg border border-border text-fg-muted hover:bg-surface-hover disabled:opacity-40 disabled:cursor-not-allowed">
                      Próxima <ChevronRight size={14} />
                    </button>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      <BulkActionBar
        count={selected.size}
        total={filtered.length}
        allSelected={allFilteredSelected}
        busy={applyingBulk}
        onSelectAll={() => setSelected(new Set(filtered.map((l) => l.id)))}
        onClear={() => setSelected(new Set())}
        onCampaign={openCampaign}
        onStatus={(s) => applyBulk('status', s)}
        onResponsavel={(r) => applyBulk('responsavel', r)}
        onDelete={() => setConfirmingDelete(true)}
      />

      <LeadDrawer
        lead={drawerLead}
        focusNotes={drawer?.focusNotes ?? false}
        saving={!!drawerLead && updatingId === drawerLead.id}
        onClose={() => setDrawer(null)}
        onSaveNotes={saveNotes}
        onContato={(lead, status) => handleLeadUpdate(lead, { status })}
        onSaveLinks={(lead, data) => handleLeadUpdate(lead, data)}
        onConvert={convertLead}
      />

      <ConfirmDialog
        open={!!deletingNicho}
        title="Apagar aba"
        message={deletingNicho ? `Apagar a aba "${deletingNicho.nome}" e todos os leads dela?` : ''}
        confirmLabel="Apagar"
        onConfirm={confirmDeleteNicho}
        onClose={() => setDeletingNicho(null)}
      />

      <ConfirmDialog
        open={!!repetidas}
        title="Busca repetida"
        message={repetidas && active
          ? `Você já buscou "${active.nome}" em ${repetidas.map((r) => `"${r.cidade}" ${diasLabel(r.diasAtras)}`).join(', ')}. Buscar de novo mesmo assim?`
          : ''}
        confirmLabel="Buscar de novo"
        onConfirm={executarBusca}
        onClose={() => setRepetidas(null)}
      />

      <ConfirmDialog
        open={confirmingDelete || !!deletingLead}
        title="Excluir leads"
        message={deletingLead
          ? `1 lead será excluído: "${deletingLead.arenaName}". Essa ação não pode ser desfeita.`
          : `${selected.size} ${selected.size === 1 ? 'lead será excluído' : 'leads serão excluídos'}. Essa ação não pode ser desfeita.`}
        confirmLabel={deletingLead ? 'Excluir 1 lead' : `Excluir ${selected.size} ${selected.size === 1 ? 'lead' : 'leads'}`}
        loading={deleting}
        onConfirm={confirmDelete}
        onClose={() => { setConfirmingDelete(false); setDeletingLead(null) }}
      />

      <ImportPreviewModal
        open={!!preview}
        rows={preview?.rows ?? []}
        totalRows={preview?.totalRows ?? 0}
        truncated={preview?.truncated ?? false}
        onClose={() => setPreview(null)}
        onConfirm={handleConfirmImport}
        confirming={confirmingImport}
      />
    </>
  )
}
