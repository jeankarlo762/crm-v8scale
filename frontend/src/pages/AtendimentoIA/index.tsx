import { useCallback, useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { Bot, CheckCircle2, Info, Loader2, QrCode, XCircle } from 'lucide-react'
import { PageHeader } from '../../components/layout/AppLayout'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { Input } from '../../components/ui/Input'
import { Select } from '../../components/ui/Select'
import { Spinner } from '../../components/ui/Spinner'
import { Textarea } from '../../components/ui/Textarea'
import * as aiApi from '../../api/ai.api'
import { useAuthStore } from '../../store/auth.store'
import { errMsg } from '../../utils/apiError'
import { cn } from '../../utils/cn'

const WA_STATUS = {
  connected: { label: 'Conectado', color: 'bg-tone-green-bg text-tone-green-fg', icon: CheckCircle2 },
  connecting: { label: 'Aguardando QR', color: 'bg-tone-orange-bg text-orange-700 dark:bg-orange-900/30 dark:text-orange-400', icon: Loader2 },
  disconnected: { label: 'Desconectado', color: 'bg-surface-hover text-fg-muted', icon: XCircle },
} as const

function WhatsAppCard({ initial, canEdit }: { initial: aiApi.WhatsAppInfo; canEdit: boolean }) {
  const [info, setInfo] = useState(initial)
  const [busy, setBusy] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const refresh = useCallback(async () => {
    try { setInfo(await aiApi.getWhatsAppStatus()) } catch { /* ignora */ }
  }, [])

  useEffect(() => {
    if (info.status === 'connecting') pollRef.current = setInterval(refresh, 3000)
    return () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null } }
  }, [info.status, refresh])

  async function connect() {
    setBusy(true)
    try {
      setInfo(await aiApi.connectWhatsApp())
      toast.success('Escaneie o QR Code com o WhatsApp principal da loja')
    } catch (err) {
      toast.error(errMsg(err) ?? 'Erro ao iniciar a conexão')
    } finally { setBusy(false) }
  }

  async function disconnect() {
    setBusy(true)
    try {
      await aiApi.disconnectWhatsApp()
      setInfo({ status: 'disconnected', qr: null })
      toast.success('WhatsApp desconectado')
    } catch (err) {
      toast.error(errMsg(err) ?? 'Erro ao desconectar')
    } finally { setBusy(false) }
  }

  const cfg = WA_STATUS[info.status]
  const Icon = cfg.icon
  return (
    <Card className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-tone-green-solid/10 flex items-center justify-center shrink-0"><QrCode size={18} className="text-tone-green-fg" /></div>
          <div>
            <p className="text-sm font-semibold text-fg">WhatsApp da loja</p>
            <p className="text-xs text-fg-muted">Número principal que recebe os leads do tráfego. É nele que a IA conversa.</p>
          </div>
        </div>
        <span className={cn('inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full', cfg.color)}>
          <Icon size={12} className={info.status === 'connecting' ? 'animate-spin' : ''} />{cfg.label}
        </span>
      </div>

      {info.status === 'connecting' && (
        <div className="flex flex-col items-center gap-2 py-2">
          {info.qr
            ? <><img src={info.qr} alt="QR Code WhatsApp" className="w-44 h-44 rounded-lg border border-border" /><p className="text-xs text-fg-muted">O QR Code expira em ~60s e se atualiza sozinho.</p></>
            : <div className="flex items-center gap-2 py-6"><Spinner size="sm" /><span className="text-sm text-fg-muted">Gerando QR Code...</span></div>}
        </div>
      )}

      {canEdit && (info.status === 'connected'
        ? <div><Button variant="secondary" onClick={() => void disconnect()} loading={busy}>Desconectar</Button></div>
        : <div><Button onClick={() => void connect()} loading={busy} disabled={info.status === 'connecting'}>{info.status === 'connecting' ? 'Aguardando QR Code...' : 'Conectar WhatsApp'}</Button></div>)}

      <p className="text-xs text-fg-muted">
        Conexão não-oficial (QR Code, Baileys): o WhatsApp pode bloquear o número. Os vendedores <strong>não</strong> atendem por aqui;
        eles chamam o lead pelo celular deles, pelo link do CRM.
      </p>
    </Card>
  )
}

export default function AtendimentoIAPage() {
  const canEdit = useAuthStore((s) => s.hasRole('ADMIN'))
  const [cfg, setCfg] = useState<aiApi.AiConfig | null>(null)
  const [form, setForm] = useState<aiApi.AiConfigInput>({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    aiApi.getConfig()
      .then((c) => { setCfg(c); setForm(c) })
      .catch((err) => toast.error(errMsg(err) ?? 'Erro ao carregar a configuração'))
  }, [])

  const set = <K extends keyof aiApi.AiConfigInput>(k: K, v: aiApi.AiConfigInput[K]) => setForm((f) => ({ ...f, [k]: v }))

  async function save() {
    setSaving(true)
    try {
      const c = await aiApi.saveConfig({
        enabled: !!form.enabled,
        storeName: form.storeName ?? null,
        instructions: form.instructions ?? null,
        model: form.model || cfg?.model,
        distribution: form.distribution,
        reviewLink: form.reviewLink ?? '',
        reviewMessage: form.reviewMessage ?? null,
        reviewAutoSend: !!form.reviewAutoSend,
      })
      setCfg(c)
      toast.success(c.enabled ? 'Salvo. O funil ganhou as etapas "Atendimento IA" e "Atendimento do vendedor".' : 'Configuração salva')
    } catch (err) {
      toast.error(errMsg(err) ?? 'Não foi possível salvar')
    } finally { setSaving(false) }
  }

  return (
    <div>
      <PageHeader title="Atendimento IA" subtitle="A IA responde o lead na hora, qualifica e entrega pronto para o vendedor assumir" />
      {!cfg ? (
        <div className="flex justify-center py-16"><Spinner size="md" /></div>
      ) : (
        <div className="flex flex-col gap-5 max-w-2xl">
          {!cfg.apiKeyConfigured && (
            <div className="bg-tone-amber-bg text-tone-amber-fg rounded-xl p-4 flex items-start gap-3 text-sm">
              <Info size={18} className="shrink-0 mt-0.5" />
              <p>Defina a variável <code className="font-mono">ANTHROPIC_API_KEY</code> no backend para a IA poder responder.</p>
            </div>
          )}

          <WhatsAppCard initial={cfg.whatsapp} canEdit={canEdit} />

          <Card className="flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-violet-100 text-violet-600 dark:bg-violet-900/30"><Bot size={20} /></div>
              <div className="flex-1">
                <p className="text-sm font-semibold text-fg">Pré-atendimento por IA</p>
                <p className="text-xs text-fg-muted">Lead novo cai em “Atendimento IA”, é distribuído a um vendedor e a IA conversa até ele assumir.</p>
              </div>
            </div>

            <label className="flex items-center gap-2 text-sm text-fg cursor-pointer select-none">
              <input type="checkbox" disabled={!canEdit} checked={!!form.enabled} onChange={(e) => set('enabled', e.target.checked)} className="w-4 h-4 rounded accent-orange-500" />
              IA ligada
            </label>
            <Input label="Nome da loja" disabled={!canEdit} value={form.storeName ?? ''} onChange={(e) => set('storeName', e.target.value)} placeholder="Ex.: Home Motors" />
            <Textarea
              label="Instruções para a IA"
              rows={5}
              disabled={!canEdit}
              value={form.instructions ?? ''}
              onChange={(e) => set('instructions', e.target.value)}
              placeholder="Horário de atendimento, aceita troca?, formas de pagamento, tom de voz, o que nunca prometer..."
            />
            <Select
              label="Distribuição entre vendedores"
              disabled={!canEdit}
              value={form.distribution ?? 'ROUND_ROBIN'}
              onChange={(e) => set('distribution', e.target.value as aiApi.Distribution)}
              options={[
                { value: 'ROUND_ROBIN', label: 'Sequencial (um de cada vez, em ordem)' },
                { value: 'RANDOM', label: 'Aleatória' },
                { value: 'NONE', label: 'Sem distribuição (lead entra sem responsável)' },
              ]}
            />
            <Input label="Modelo de IA" disabled={!canEdit} value={form.model ?? ''} onChange={(e) => set('model', e.target.value)} />
          </Card>

          <Card className="flex flex-col gap-4">
            <div>
              <p className="text-sm font-semibold text-fg">Avaliação no Google Meu Negócio</p>
              <p className="text-xs text-fg-muted">Ao fim do atendimento, o cliente recebe o link para avaliar a loja. Reduz churn e mostra resultado visual.</p>
            </div>
            <Input label="Link de avaliação" disabled={!canEdit} value={form.reviewLink ?? ''} onChange={(e) => set('reviewLink', e.target.value)} placeholder="https://g.page/r/.../review" />
            <Textarea
              label="Mensagem (use {link} onde o link deve entrar)"
              rows={3}
              disabled={!canEdit}
              value={form.reviewMessage ?? ''}
              onChange={(e) => set('reviewMessage', e.target.value)}
              placeholder="Obrigado pela confiança! Se puder, avalie nosso atendimento com 5 estrelas: {link}"
            />
            <label className="flex items-center gap-2 text-sm text-fg cursor-pointer select-none">
              <input type="checkbox" disabled={!canEdit} checked={!!form.reviewAutoSend} onChange={(e) => set('reviewAutoSend', e.target.checked)} className="w-4 h-4 rounded accent-orange-500" />
              Enviar automaticamente quando o lead for ganho
            </label>
          </Card>

          {canEdit && <div><Button onClick={() => void save()} loading={saving}>Salvar</Button></div>}
        </div>
      )}
    </div>
  )
}
