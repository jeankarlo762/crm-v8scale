import {
  LayoutDashboard, Kanban, Users, CheckSquare, UserCheck, UsersRound, Settings, Target, Megaphone, Trophy, BarChart3, Archive, type LucideIcon,
} from 'lucide-react'
import type { Role } from '../types'

export interface NavItem {
  to: string
  icon: LucideIcon
  label: string
  end?: boolean
  /** Sem `roles`, todo usuário autenticado enxerga o item. */
  roles?: Role[]
}

export interface NavGroup {
  title: string
  items: NavItem[]
}

// Registro dos módulos do CRM. Para adicionar um novo módulo: crie um grupo aqui,
// as páginas em src/pages/<modulo>/ e as rotas em App.tsx — a sidebar e o
// controle de acesso por perfil já funcionam sozinhos.
export const navGroups: NavGroup[] = [
  {
    title: 'Comercial',
    items: [
      { to: '/', icon: LayoutDashboard, label: 'Dashboard', end: true },
      { to: '/funil', icon: Kanban, label: 'Funil' },
      { to: '/leads', icon: Users, label: 'Leads' },
      { to: '/tarefas', icon: CheckSquare, label: 'Tarefas' },
      { to: '/clientes', icon: UserCheck, label: 'Clientes', end: true },
      { to: '/clientes/arquivados', icon: Archive, label: 'Clientes arquivados' },
      { to: '/metas', icon: Trophy, label: 'Metas' },
    ],
  },
  {
    title: 'Prospecção',
    items: [
      { to: '/prospeccao', icon: Target, label: 'Prospecção', roles: ['ADMIN', 'MANAGER'] },
      { to: '/campanhas', icon: Megaphone, label: 'Campanhas', roles: ['ADMIN', 'MANAGER'] },
    ],
  },
  {
    title: 'Relatórios',
    items: [
      { to: '/relatorios', icon: BarChart3, label: 'Relatórios', roles: ['ADMIN', 'MANAGER'] },
    ],
  },
  {
    title: 'Administração',
    items: [
      { to: '/usuarios', icon: UsersRound, label: 'Usuários', roles: ['ADMIN'] },
      { to: '/configuracoes', icon: Settings, label: 'Configurações', roles: ['ADMIN'] },
    ],
  },
]
