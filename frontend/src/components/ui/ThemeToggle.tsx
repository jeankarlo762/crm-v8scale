import { Sun, Moon } from 'lucide-react'
import { cn } from '../../utils/cn'
import { useUIStore } from '../../store/ui.store'

// Botão único: clique alterna claro/escuro. `onDark` = usado sobre fundo escuro fixo (sidebar).
export function ThemeToggle({ onDark = false }: { onDark?: boolean; menuPlacement?: string }) {
  const { darkMode, toggleDarkMode } = useUIStore()
  return (
    <button
      type="button"
      onClick={toggleDarkMode}
      aria-label="Alternar tema"
      title={darkMode ? 'Mudar para claro' : 'Mudar para escuro'}
      className={cn(
        'p-2 rounded-lg',
        onDark ? 'text-gray-300 hover:bg-gray-700 hover:text-white' : 'text-fg-muted hover:bg-surface-hover hover:text-fg',
      )}
    >
      {darkMode ? <Moon size={18} /> : <Sun size={18} />}
    </button>
  )
}
