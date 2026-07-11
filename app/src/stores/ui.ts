import { create } from 'zustand'

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
  sidebarOpen: boolean
  rightPanelOpen: boolean
  activePanel: PanelName | null
  commandPaletteOpen: boolean
  toasts: Toast[]
  toggleSidebar: () => void
  setSidebarOpen: (open: boolean) => void
  toggleRightPanel: () => void
  setRightPanelOpen: (open: boolean) => void
  setActivePanel: (panel: PanelName | null) => void
  setCommandPaletteOpen: (open: boolean) => void
  addToast: (toast: Omit<Toast, 'id'>) => void
  removeToast: (id: string) => void
}

export const useUiStore = create<UiState>()((set) => ({
  sidebarOpen: true,
  rightPanelOpen: false,
  activePanel: 'sessions',
  commandPaletteOpen: false,
  toasts: [],
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  toggleRightPanel: () => set((s) => ({ rightPanelOpen: !s.rightPanelOpen })),
  setRightPanelOpen: (open) => set({ rightPanelOpen: open }),
  setActivePanel: (panel) => set({ activePanel: panel }),
  setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),
  addToast: (toast) =>
    set((s) => ({
      toasts: [...s.toasts, { ...toast, id: crypto.randomUUID() }],
    })),
  removeToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}))

export function applyTheme(theme: 'dark' | 'dim' | 'light') {
  document.documentElement.setAttribute('data-theme', theme)
}
