import api from './axios'
import type { Role, User } from '../types'

export async function listUsers(): Promise<User[]> {
  const { data } = await api.get<User[]>('/users')
  return data
}

export async function createUser(input: {
  name: string
  email: string
  phone?: string | null
  password: string
  role: Role
}): Promise<User> {
  const { data } = await api.post<User>('/users', input)
  return data
}

export async function updateUser(
  id: string,
  input: { name?: string; phone?: string | null; role?: Role; active?: boolean },
): Promise<User> {
  const { data } = await api.patch<User>(`/users/${id}`, input)
  return data
}

export async function resetUserPassword(id: string, password: string): Promise<void> {
  await api.post(`/users/${id}/password`, { password })
}
