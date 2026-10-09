import axios from 'axios'

const baseURL = import.meta.env.VITE_API_URL ? `${import.meta.env.VITE_API_URL}/api` : '/api'

const api = axios.create({
  baseURL,
  headers: { 'Content-Type': 'application/json' },
})

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('accessToken')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

let isRefreshing = false
let failedQueue: Array<{ resolve: (token: string) => void; reject: (err: unknown) => void }> = []

function processQueue(error: unknown, token: string | null) {
  failedQueue.forEach((p) => (error ? p.reject(error) : p.resolve(token!)))
  failedQueue = []
}

function goToLogin() {
  localStorage.removeItem('accessToken')
  localStorage.removeItem('refreshToken')
  if (window.location.pathname !== '/login') window.location.href = '/login'
}

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config
    // Só login, refresh e logout ficam fora do refresh automático. /auth/me e
    // /auth/me/password são rotas normais: sem isso, abrir o app com o access
    // token vencido (15 min) derrubava o usuário para o login.
    const NO_REFRESH = ['/auth/login', '/auth/refresh', '/auth/logout']
    const isAuthCall = typeof originalRequest?.url === 'string' && NO_REFRESH.some((p) => originalRequest.url.startsWith(p))

    // 401 numa rota normal: tenta renovar o token uma vez e repete a chamada.
    if (error.response?.status === 401 && !originalRequest._retry && !isAuthCall) {
      if (isRefreshing) {
        return new Promise<string>((resolve, reject) => failedQueue.push({ resolve, reject })).then((token) => {
          originalRequest._retry = true
          originalRequest.headers.Authorization = `Bearer ${token}`
          return api(originalRequest)
        })
      }

      originalRequest._retry = true
      isRefreshing = true

      const refreshToken = localStorage.getItem('refreshToken')
      if (!refreshToken) {
        isRefreshing = false
        goToLogin()
        return Promise.reject(error)
      }

      try {
        // axios "puro" (sem os interceptors) para não entrar em loop.
        const res = await axios.post(`${baseURL}/auth/refresh`, { refreshToken })
        const { accessToken, refreshToken: newRefresh } = res.data
        localStorage.setItem('accessToken', accessToken)
        localStorage.setItem('refreshToken', newRefresh)
        processQueue(null, accessToken)
        originalRequest.headers.Authorization = `Bearer ${accessToken}`
        return api(originalRequest)
      } catch (refreshError) {
        processQueue(refreshError, null)
        goToLogin()
        return Promise.reject(refreshError)
      } finally {
        isRefreshing = false
      }
    }

    return Promise.reject(error)
  },
)

export default api
