import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import * as api from '../api/commercial.api'
import * as usersApi from '../api/users.api'
import { useAuthStore } from '../store/auth.store'
import type { Stage, UserRef } from '../types'

/** Etapas do funil + lista de responsáveis possíveis (só admin/gerente enxergam a equipe). */
export function useCommercialData() {
  const canAssign = useAuthStore((s) => s.hasRole('ADMIN', 'MANAGER'))
  const [stages, setStages] = useState<Stage[]>([])
  const [users, setUsers] = useState<UserRef[]>([])

  useEffect(() => {
    api.listStages().then(setStages).catch(() => toast.error('Não foi possível carregar as etapas do funil'))
  }, [])

  useEffect(() => {
    if (!canAssign) return
    usersApi
      .listUsers()
      .then((list) => setUsers(list.filter((u) => u.active).map(({ id, name }) => ({ id, name }))))
      .catch(() => undefined)
  }, [canAssign])

  return { stages, users, canAssign }
}
