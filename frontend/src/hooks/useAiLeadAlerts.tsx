import { useEffect, useRef } from 'react'
import toast from 'react-hot-toast'
import * as aiApi from '../api/ai.api'
import { useAuthStore } from '../store/auth.store'

const POLL_MS = 15_000

/**
 * Avisa o vendedor (toast) quando cai um lead novo para ele em atendimento pela IA. Ao tocar em "Assumir"
 * a IA para de responder no WhatsApp. Vendedor só recebe os leads designados a ele; gerente recebe todos.
 */
export function useAiLeadAlerts() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const sinceRef = useRef<string | undefined>(undefined)
  const seen = useRef(new Set<string>())

  useEffect(() => {
    if (!isAuthenticated) return
    let stopped = false

    async function tick() {
      try {
        const { now, leads } = await aiApi.getAlerts(sinceRef.current)
        if (stopped) return
        const first = sinceRef.current === undefined
        sinceRef.current = now
        // Primeira consulta só marca o ponto de partida: não reapresenta leads antigos a cada abertura do app.
        if (first) return
        for (const lead of leads) {
          if (seen.current.has(lead.id)) continue
          seen.current.add(lead.id)
          toast(
            (t) => (
              <div className="flex items-center gap-3">
                <div className="text-sm">
                  <p className="font-semibold">Novo lead na IA</p>
                  <p className="text-fg-muted">{lead.name} está conversando com a IA</p>
                </div>
                <button
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-orange-500 text-white hover:bg-orange-600"
                  onClick={() => {
                    toast.dismiss(t.id)
                    aiApi.assumeLead(lead.id).then(() => toast.success('Você assumiu o atendimento')).catch(() => toast.error('Não foi possível assumir'))
                  }}
                >
                  Assumir
                </button>
              </div>
            ),
            { duration: 15_000, icon: '🤖' },
          )
        }
      } catch { /* sem rede / sem permissão: tenta de novo no próximo ciclo */ }
    }

    void tick()
    const timer = setInterval(() => void tick(), POLL_MS)
    return () => { stopped = true; clearInterval(timer) }
  }, [isAuthenticated])
}
