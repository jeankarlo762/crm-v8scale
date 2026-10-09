import { create } from 'zustand'

export type ThemePreference = 'light' | 'dark' | 'system'

interface UIState {
  sidebarOpen: boolean
  theme: ThemePreference
  // Tema efetivo (já resolvido pra light/dark); mantido pra quem só precisa do booleano.
  darkMode: boolean
  toggleSidebar: () => void
  setSidebarOpen: (open: boolean) => void
  setTheme: (theme: ThemePreference) => void
  toggleDarkMode: () => void
}

const STORAGE_KEY = 'theme'
const media = window.matchMedia('(prefers-color-scheme: dark)')

function readSaved(): ThemePreference {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'light' || saved === 'dark' || saved === 'system') return saved
    // Migra a chave antiga (boolean "darkMode") do toggle binário anterior.
    const legacy = localStorage.getItem('darkMode')
    if (legacy === 'true') return 'dark'
    if (legacy === 'false') return 'light'
  } catch { /* localStorage indisponível */ }
  return 'system'
}

function resolveDark(theme: ThemePreference): boolean {
  return theme === 'dark' || (theme === 'system' && media.matches)
}

function applyTheme(theme: ThemePreference): boolean {
  const dark = resolveDark(theme)
  document.documentElement.classList.toggle('dark', dark)
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
  return dark
}

const initial = readSaved()
const initialDark = applyTheme(initial)

export const useUIStore = create<UIState>((set, get) => ({
  sidebarOpen: true,
  theme: initial,
  darkMode: initialDark,

  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),

  setTheme: (theme) => {
    try { localStorage.setItem(STORAGE_KEY, theme) } catch { /* ignore */ }
    set({ theme, darkMode: applyTheme(theme) })
  },

  toggleDarkMode: () => get().setTheme(get().darkMode ? 'light' : 'dark'),
}))

// No modo "Sistema", acompanha a troca de tema do sistema operacional em tempo real.
media.addEventListener('change', () => {
  const { theme } = useUIStore.getState()
  if (theme === 'system') useUIStore.setState({ darkMode: applyTheme('system') })
})
