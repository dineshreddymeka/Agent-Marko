import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type Theme = 'dark' | 'dim' | 'light'

export type PanelName =
  | 'sessions'
  | 'workspace'
  | 'skills'
  | 'memory'
  | 'cron'
  | 'profiles'
  | 'settings'

export interface Toast {
  id: string
  title: string
  description?: string
  variant?: 'default' | 'success' | 'danger' | 'attention'
}

interface UiState {
  theme: Theme
  sidebarOpen: boolean
  rightPanelOpen: boolean
  activePanel: PanelName | null
  commandPaletteOpen: boolean
  toasts: Toast[]
  setTheme: (theme: Theme) => void
  cycleTheme: () => void
  toggleSidebar: () => void
  toggleRightPanel: () => void
  setSidebarOpen: (open: boolean) => void
  setRightPanelOpen: (open: boolean) => void
  setActivePanel: (panel: PanelName | null) => void
  setCommandPaletteOpen: (open: boolean) => void
  addToast: (toast: Omit<Toast, 'id'> & { id?: string }) => void
  removeToast: (id: string) => void
}

const THEMES: Theme[] = ['dark', 'dim', 'light']

function applyTheme(theme: Theme) {
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.theme = theme
  }
}

export const useUiStore = create<UiState>()(
  persist(
    (set, get) => ({
      theme: 'dark',
      sidebarOpen: true,
      rightPanelOpen: false,
      activePanel: null,
      commandPaletteOpen: false,
      toasts: [],
      setTheme: (theme) => {
        applyTheme(theme)
        set({ theme })
      },
      cycleTheme: () => {
        const current = get().theme
        const next = THEMES[(THEMES.indexOf(current) + 1) % THEMES.length] ?? 'dark'
        applyTheme(next)
        set({ theme: next })
      },
      toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
      toggleRightPanel: () => set((s) => ({ rightPanelOpen: !s.rightPanelOpen })),
      setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
      setRightPanelOpen: (rightPanelOpen) => set({ rightPanelOpen }),
      setActivePanel: (activePanel) => set({ activePanel }),
      setCommandPaletteOpen: (commandPaletteOpen) => set({ commandPaletteOpen }),
      addToast: (toast) =>
        set((s) => ({
          toasts: [
            ...s.toasts,
            {
              id: toast.id ?? crypto.randomUUID(),
              title: toast.title,
              description: toast.description,
              variant: toast.variant ?? 'default',
            },
          ],
        })),
      removeToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
    }),
    {
      name: 'hermes-ui',
      partialize: (s) => ({ theme: s.theme }),
      onRehydrateStorage: () => (state) => {
        if (state?.theme) applyTheme(state.theme)
      },
    },
  ),
)

applyTheme('dark')

export { applyTheme }
