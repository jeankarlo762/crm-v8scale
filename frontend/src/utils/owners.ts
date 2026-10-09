import type { UserRef } from '../types'

/** Opções de responsável; inclui o atual mesmo que esteja inativo (senão o select o "perde"). */
export function ownerOptions(users: UserRef[], current: UserRef | null, emptyLabel = 'Sem responsável') {
  const list = current && !users.some((u) => u.id === current.id) ? [...users, { ...current, name: `${current.name} (inativo)` }] : users
  return [{ value: '', label: emptyLabel }, ...list.map((u) => ({ value: u.id, label: u.name }))]
}
