import api from './axios'
import type { LoginResponse, User } from '../types'

export async function login(email: string, password: string): Promise<LoginResponse> {
  const { data } = await api.post<LoginResponse>('/auth/login', { email, password })
  return data
}

export async function logout(refreshToken: string): Promise<void> {
  await api.post('/auth/logout', { refreshToken })
}

export async function getMe(): Promise<User> {
  const { data } = await api.get<User>('/auth/me')
  return data
}

export async function updateMe(input: { name: string; phone?: string | null }): Promise<User> {
  const { data } = await api.patch<User>('/auth/me', input)
  return data
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  await api.post('/auth/me/password', { currentPassword, newPassword })
}
