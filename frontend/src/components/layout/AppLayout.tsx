import { ReactNode, useState, useRef, useLayoutEffect } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { LogOut, Menu, X, ChevronDown, UserCircle } from 'lucide-react'
import { cn } from '../../utils/cn'
import { useAuth } from '../../hooks/useAuth'
import { ThemeToggle } from '../ui/ThemeToggle'
import { useAiLeadAlerts } from '../../hooks/useAiLeadAlerts'
import { navGroups } from '../../config/modules'

/** Marca da V8 Scale (public/logo.svg) sobre um quadro branco, para ler bem na barra escura. */
function BrandMark({ size = 'md' }: { size?: 'sm' | 'md' }) {
  return (
    <div className={cn('bg-white rounded-lg flex items-center justify-center shrink-0', size === 'md' ? 'w-8 h-8 p-1' : 'w-6 h-6 p-0.5 rounded-md')}>
      <img src="/logo.png" alt="V8 Scale" className="w-full h-full object-contain" draggable={false} />
    </div>
  )
}

function SidebarContent({ onClose }: { onClose?: () => void }) {
  const { user, hasRole, logout } = useAuth()
  const navigate = useNavigate()
  const navRef = useRef<HTMLElement>(null)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  // Preserva o scroll do menu entre navegações (a sidebar fica montada, mas o
  // drawer mobile remonta a cada abertura).
  useLayoutEffect(() => {
    if (navRef.current) navRef.current.scrollTop = 0
  }, [])

  async function handleLogout() {
    await logout()
    navigate('/login', { replace: true })
  }

  return (
    <>
      <div className="flex items-center justify-between px-5 h-16 border-b border-gray-700 shrink-0">
        <div className="flex items-center gap-3">
          <BrandMark />
          <div className="flex flex-col">
            <span className="font-bold text-sm tracking-tight leading-none">CRM V8 Scale</span>
            <span className="text-[10px] text-orange-400 font-medium mt-0.5">Gestão interna</span>
          </div>
        </div>
        {onClose && (
          <button onClick={onClose} aria-label="Fechar menu" className="p-1 rounded-lg hover:bg-gray-700 transition-colors lg:hidden">
            <X size={18} />
          </button>
        )}
      </div>

      <nav ref={navRef} className="flex-1 py-4 overflow-y-auto">
        {navGroups.map((group, i) => {
          const items = group.items.filter((item) => !item.roles || hasRole(...item.roles))
          if (items.length === 0) return null
          return (
            <div key={group.title} className={cn(i > 0 && 'mt-4 pt-4 border-t border-gray-700/60')}>
              <button
                type="button"
                onClick={() => setCollapsed((prev) => ({ ...prev, [group.title]: !prev[group.title] }))}
                className="w-full flex items-center justify-between px-6 pb-1.5 text-[11px] font-semibold text-gray-500 uppercase tracking-wide hover:text-gray-300 transition-colors"
              >
                {group.title}
                <ChevronDown size={13} className={cn('transition-transform', collapsed[group.title] && '-rotate-90')} />
              </button>
              <div
                className={cn(
                  'overflow-hidden transition-all duration-200 ease-in-out',
                  collapsed[group.title] ? 'max-h-0 opacity-0' : 'max-h-[1000px] opacity-100',
                )}
              >
                {items.map(({ to, icon: Icon, label, end }) => (
                  <NavLink
                    key={to}
                    to={to}
                    end={end}
                    onClick={onClose}
                    className={({ isActive }) =>
                      cn(
                        'flex items-center gap-3 px-4 py-2.5 mx-2 rounded-lg text-sm font-medium transition-colors',
                        isActive ? 'bg-orange-500 text-white' : 'text-gray-300 hover:bg-gray-700 hover:text-white',
                      )
                    }
                  >
                    <Icon size={18} className="shrink-0" />
                    <span>{label}</span>
                  </NavLink>
                ))}
              </div>
            </div>
          )
        })}
      </nav>

      <div className="border-t border-gray-700 p-4 shrink-0">
        {user && (
          <NavLink to="/minha-conta" onClick={onClose} className="mb-3 flex items-center gap-2 rounded-lg hover:bg-gray-800 -mx-1 px-1 py-1 transition-colors">
            <UserCircle size={28} className="text-gray-500 shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-medium text-white truncate">{user.name}</p>
              <p className="text-xs text-gray-400 truncate">{user.email}</p>
            </div>
          </NavLink>
        )}
        <div className="flex items-center gap-1">
          <button
            onClick={handleLogout}
            className="flex flex-1 items-center gap-3 px-2 py-2 rounded-lg text-sm text-gray-300 hover:bg-gray-700 hover:text-white transition-colors"
          >
            <LogOut size={18} className="shrink-0" />
            <span>Sair</span>
          </button>
          <ThemeToggle onDark />
        </div>
      </div>
    </>
  )
}

export function AppLayout() {
  const [mobileOpen, setMobileOpen] = useState(false)
  useAiLeadAlerts()

  return (
    <div className="min-h-screen flex bg-background text-fg">
      {/* Sidebar desktop */}
      <aside className="hidden lg:flex w-60 bg-gray-900 text-white flex-col fixed h-full z-30">
        <SidebarContent />
      </aside>

      {/* Drawer mobile */}
      {mobileOpen && <div className="fixed inset-0 bg-black/40 z-40 lg:hidden" onClick={() => setMobileOpen(false)} />}
      <aside
        className={cn(
          'fixed top-0 left-0 h-full w-64 bg-gray-900 text-white flex flex-col z-50 transition-transform duration-200 lg:hidden',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <SidebarContent onClose={() => setMobileOpen(false)} />
      </aside>

      <main className="flex-1 lg:ml-60 min-w-0">
        <div className="lg:hidden flex items-center gap-3 px-4 h-14 bg-gray-900 text-white sticky top-0 z-20">
          <button onClick={() => setMobileOpen(true)} aria-label="Abrir menu" className="p-1.5 rounded-lg hover:bg-gray-700 transition-colors">
            <Menu size={20} />
          </button>
          <div className="flex items-center gap-2">
            <BrandMark size="sm" />
            <span className="font-bold text-sm">CRM V8 Scale</span>
          </div>
          <div className="ml-auto"><ThemeToggle onDark /></div>
        </div>

        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-10 py-6 lg:py-8">
          <Outlet />
        </div>
      </main>
    </div>
  )
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6 lg:mb-8">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-fg">{title}</h1>
        {subtitle && <p className="text-sm text-fg-muted mt-1">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0 flex flex-wrap items-center gap-2">{action}</div>}
    </div>
  )
}
