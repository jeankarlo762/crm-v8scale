import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { Plug, Copy, Info, CheckCircle2 } from 'lucide-react'
import { PageHeader } from '../../components/layout/AppLayout'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { Input } from '../../components/ui/Input'
import { Spinner } from '../../components/ui/Spinner'
import * as contractsApi from '../../api/contracts.api'
import type { ZapSignConfig } from '../../api/contracts.api'
import { errMsg } from '../../utils/apiError'

// URL pública do webhook (no backend), com o segredo que autentica o ZapSign.
function webhookUrl(secret: string): string {
  const base = import.meta.env.VITE_API_URL || window.location.origin
  return `${String(base).replace(/\/$/, '')}/api/zapsign/webhook/${secret}`
}

export default function IntegracoesPage() {
  const [cfg, setCfg] = useState<ZapSignConfig | null>(null)
  const [apiToken, setApiToken] = useState('')
  const [sandbox, setSandbox] = useState(false)
  const [active, setActive] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    contractsApi.getZapSignConfig()
      .then((z) => { setCfg(z); setSandbox(z.sandbox); setActive(z.active) })
      .catch((err) => toast.error(errMsg(err) ?? 'Erro ao carregar a integração'))
  }, [])

  async function save() {
    setSaving(true)
    try {
      const c = await contractsApi.setZapSignConfig({ ...(apiToken.trim() && { apiToken: apiToken.trim() }), sandbox, active })
      setCfg(c)
      setApiToken('')
      toast.success('Integração salva')
    } catch (err) {
      toast.error(errMsg(err) ?? 'Não foi possível salvar')
    } finally {
      setSaving(false)
    }
  }

  function copyWebhook() {
    if (!cfg) return
    navigator.clipboard.writeText(webhookUrl(cfg.webhookSecret)).then(() => toast.success('URL do webhook copiada'), () => toast.error('Não foi possível copiar'))
  }

  return (
    <div>
      <PageHeader title="Integrações" subtitle="Serviços externos usados pelo CRM" />

      {!cfg ? (
        <div className="flex items-center justify-center py-16"><Spinner size="md" /></div>
      ) : (
        <div className="flex flex-col gap-5 max-w-2xl">
          <Card className="flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${cfg.configured && cfg.active ? 'bg-tone-green-bg text-tone-green-fg' : 'bg-tone-gray-bg text-tone-gray-fg'}`}>
                <Plug size={20} />
              </div>
              <div className="flex-1">
                <p className="text-sm font-semibold text-fg">ZapSign: assinatura eletrônica</p>
                <p className="text-xs text-fg-muted">Envia os contratos e coleta a assinatura on-line.</p>
              </div>
              {cfg.configured && cfg.active && (
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-tone-green-bg text-tone-green-fg inline-flex items-center gap-1">
                  <CheckCircle2 size={12} />Conectado
                </span>
              )}
            </div>

            <div>
              <Input
                label="Token da API"
                type="password"
                autoComplete="off"
                value={apiToken}
                onChange={(e) => setApiToken(e.target.value)}
                placeholder={cfg.configured ? '•••••••• (vazio mantém o atual)' : 'Cole o token da API do ZapSign'}
              />
              <p className="text-xs text-fg-muted mt-1">No ZapSign: Configurações → Integração → Token de API.</p>
            </div>

            <label className="flex items-center gap-2 text-sm text-fg cursor-pointer select-none">
              <input type="checkbox" checked={sandbox} onChange={(e) => setSandbox(e.target.checked)} className="w-4 h-4 rounded accent-orange-500" />
              Usar ambiente de teste (sandbox)
            </label>
            <label className="flex items-center gap-2 text-sm text-fg cursor-pointer select-none">
              <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="w-4 h-4 rounded accent-orange-500" />
              Integração ativa
            </label>

            <div><Button onClick={() => void save()} loading={saving}>Salvar</Button></div>
          </Card>

          <div className="bg-tone-blue-bg text-tone-blue-fg rounded-xl p-4 flex items-start gap-3">
            <Info size={18} className="shrink-0 mt-0.5" />
            <div className="text-sm flex-1 min-w-0">
              <p className="font-semibold mb-1">Configure o webhook no ZapSign</p>
              <p className="mb-2">
                Em <strong>Configurações → Webhooks</strong>, adicione a URL abaixo com o evento “documento assinado”.
                É ela que dá <strong>baixa automática</strong> no contrato quando o cliente assina. Não compartilhe: o final da URL é a senha do webhook.
              </p>
              <div className="flex gap-2">
                <input readOnly value={webhookUrl(cfg.webhookSecret)} className="w-full min-w-0 rounded-lg border border-border bg-surface text-fg-muted px-3 py-2 text-xs font-mono" />
                <Button variant="secondary" onClick={copyWebhook} aria-label="Copiar URL"><Copy size={15} /></Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
