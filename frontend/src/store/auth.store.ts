import { create } from 'zustand'
import type { Role, StoredUser } from '../types'

interface AuthState {
  user: StoredUser | null
  accessToken: string | null
  refreshToken: string | null
  isAuthenticated: boolean
  // Fica false só entre "existe um token salvo" e "confirmei quem é o usuário"
  // (chamada a /auth/me em AppInit). Enquanto false, as rotas protegidas mostram
  // um loading em vez de decidir com `user` ainda null — sem isso, um F5 em
  // qualquer rota protegida chutaria o usuário para o login.
  userLoaded: boolean
  setAuth: (user: StoredUser, access: string, refresh: string) => void
  clearAuth: () => void
  setUser: (user: StoredUser) => void
  /** Encerra o estado de carregamento mesmo sem conseguir confirmar o usuário (erro de rede). */
  markLoaded: () => void
  hasRole: (...roles: Role[]) => boolean
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  accessToken: localStorage.getItem('accessToken'),
  refreshToken: localStorage.getItem('refreshToken'),
  isAuthenticated: !!localStorage.getItem('accessToken'),
  userLoaded: !localStorage.getItem('accessToken'),

  setAuth: (user, access, refresh) => {
    localStorage.setItem('accessToken', access)
    localStorage.setItem('refreshToken', refresh)
    set({ user, accessToken: access, refreshToken: refresh, isAuthenticated: true, userLoaded: true })
  },

  clearAuth: () => {
    localStorage.removeItem('accessToken')
    localStorage.removeItem('refreshToken')
    set({ user: null, accessToken: null, refreshToken: null, isAuthenticated: false, userLoaded: true })
  },

  setUser: (user) => {
    const { id, name, email, role } = user
    set({ user: { id, name, email, role }, userLoaded: true })
  },

  markLoaded: () => set({ userLoaded: true }),

  hasRole: (...roles) => {
    const role = get().user?.role
    return !!role && roles.includes(role)
  },
}))
