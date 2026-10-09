import { useState } from 'react'
import { useAuthStore } from '../store/auth.store'
import * as authApi from '../api/auth.api'

export function useAuth() {
  const store = useAuthStore()
  const [loading, setLoading] = useState(false)

  async function login(email: string, password: string) {
    setLoading(true)
    try {
      const result = await authApi.login(email, password)
      store.setAuth(result.user, result.accessToken, result.refreshToken)
      return result
    } finally {
      setLoading(false)
    }
  }

  async function logout() {
    const refreshToken = store.refreshToken
    store.clearAuth()
    if (refreshToken) await authApi.logout(refreshToken).catch(() => undefined)
  }

  return { ...store, login, logout, loading }
}
