import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { useEffect, type ReactNode } from 'react'
import { Spinner } from './components/ui/Spinner'
import { AppLayout } from './components/layout/AppLayout'
import { useAuthStore } from './store/auth.store'
import * as authApi from './api/auth.api'
import type { Role } from './types'

import LoginPage from './pages/Login'
import DashboardPage from './pages/Dashboard'
import PipelinePage from './pages/Pipeline'
import LeadsPage from './pages/Leads'
import TasksPage from './pages/Tasks'
import CustomersPage from './pages/Customers'
import ClientesArquivadosPage from './pages/ClientesArquivados'
import ProspeccaoPage from './pages/Prospeccao'
import CampanhasPage from './pages/Campanhas'
import MetasPage from './pages/Metas'
import RelatoriosPage from './pages/Relatorios'
import FinanceiroPage from './pages/Financeiro'
import ContratosPage from './pages/Contratos'
import IntegracoesPage from './pages/Integracoes'
import UsersPage from './pages/Users'
import SettingsPage from './pages/Settings'
import AccountPage from './pages/Account'

function AuthLoading() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <Spinner size="lg" className="text-orange-500" />
    </div>
  )
}

/** Exige login (e, opcionalmente, um dos perfis informados). */
function RequireAuth({ children, roles }: { children: ReactNode; roles?: Role[] }) {
  const { isAuthenticated, user, userLoaded } = useAuthStore()
  if (!isAuthenticated) return <Navigate to="/login" replace />
  if (!userLoaded) return <AuthLoading />
  if (roles && (!user || !roles.includes(user.role))) return <Navigate to="/" replace />
  return <>{children}</>
}

/** Ao abrir o app com token salvo, confirma quem é o usuário (e o perfil atual dele). */
function AppInit() {
  const accessToken = useAuthStore((s) => s.accessToken)

  useEffect(() => {
    if (!accessToken) return
    authApi
      .getMe()
      .then((u) => useAuthStore.getState().setUser(u))
      .catch((err) => {
        // 401 (mesmo após o refresh automático): sessão inválida, volta ao login.
        // Qualquer outro erro (rede, 5xx): não fica preso no spinner; libera as
        // telas e cada uma trata o próprio erro.
        if (err?.response?.status === 401) useAuthStore.getState().clearAuth()
        else useAuthStore.getState().markLoaded()
      })
  }, [accessToken])

  return null
}

export default function App() {
  return (
    <BrowserRouter>
      <AppInit />
      <Toaster
        position="top-right"
        toastOptions={{
          duration: 3000,
          style: { fontSize: '14px', background: 'rgb(var(--surface))', color: 'rgb(var(--fg))', border: '1px solid rgb(var(--border))' },
        }}
      />
      <Routes>
        <Route path="/login" element={<LoginPage />} />

        <Route element={<RequireAuth><AppLayout /></RequireAuth>}>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/funil" element={<PipelinePage />} />
          <Route path="/leads" element={<LeadsPage />} />
          <Route path="/tarefas" element={<TasksPage />} />
          <Route path="/clientes" element={<CustomersPage />} />
          <Route path="/clientes/arquivados" element={<ClientesArquivadosPage />} />
          <Route path="/prospeccao" element={<RequireAuth roles={['ADMIN', 'MANAGER']}><ProspeccaoPage /></RequireAuth>} />
          <Route path="/campanhas" element={<RequireAuth roles={['ADMIN', 'MANAGER']}><CampanhasPage /></RequireAuth>} />
          <Route path="/metas" element={<MetasPage />} />
          <Route path="/financeiro" element={<RequireAuth roles={['ADMIN', 'MANAGER']}><FinanceiroPage /></RequireAuth>} />
          <Route path="/contratos" element={<RequireAuth roles={['ADMIN', 'MANAGER']}><ContratosPage /></RequireAuth>} />
          <Route path="/relatorios" element={<RequireAuth roles={['ADMIN', 'MANAGER']}><RelatoriosPage /></RequireAuth>} />
          <Route path="/minha-conta" element={<AccountPage />} />
          <Route path="/usuarios" element={<RequireAuth roles={['ADMIN']}><UsersPage /></RequireAuth>} />
          <Route path="/configuracoes" element={<RequireAuth roles={['ADMIN']}><SettingsPage /></RequireAuth>} />
          <Route path="/integracoes" element={<RequireAuth roles={['ADMIN']}><IntegracoesPage /></RequireAuth>} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
