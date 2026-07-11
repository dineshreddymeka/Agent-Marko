import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { applyTheme } from '@app/stores/ui'

export type Theme = 'dark' | 'dim' | 'light'

interface SettingsState {
  theme: Theme
  model: string
  llmBaseUrl: string
  workspaceRoot: string
  setTheme: (theme: Theme) => void
  setModel: (model: string) => void
  setLlmBaseUrl: (url: string) => void
  setWorkspaceRoot: (root: string) => void
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      theme: 'dark',
      model: 'gpt-4o',
      llmBaseUrl: '',
      workspaceRoot: '',
      setTheme: (theme) => {
        applyTheme(theme)
        set({ theme })
      },
      setModel: (model) => set({ model }),
      setLlmBaseUrl: (llmBaseUrl) => set({ llmBaseUrl }),
      setWorkspaceRoot: (workspaceRoot) => set({ workspaceRoot }),
    }),
    {
      name: 'hermes-settings',
      onRehydrateStorage: () => (state) => {
        if (state?.theme) applyTheme(state.theme)
      },
    },
  ),
)
