import { useEffect } from 'react'
import { useUiStore } from '@app/stores/ui'
import { useChatStore } from '@app/stores/chat'
import { cancelRun } from '@app/lib/agui/client'

export function useKeyboardShortcuts() {
  const toggleSidebar = useUiStore((s) => s.toggleSidebar)
  const toggleRightPanel = useUiStore((s) => s.toggleRightPanel)
  const setCommandPaletteOpen = useUiStore((s) => s.setCommandPaletteOpen)
  const commandPaletteOpen = useUiStore((s) => s.commandPaletteOpen)

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const mod = e.ctrlKey || e.metaKey

      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setCommandPaletteOpen(!commandPaletteOpen)
        return
      }

      if (e.key === 'Escape') {
        if (commandPaletteOpen) {
          setCommandPaletteOpen(false)
          return
        }
        if (useChatStore.getState().runStatus === 'running') {
          cancelRun()
        }
        return
      }

      if (!mod) return

      if (e.key === 'b' && !e.altKey) {
        e.preventDefault()
        toggleSidebar()
        return
      }

      if (e.key === 'b' && e.altKey) {
        e.preventDefault()
        toggleRightPanel()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [
    toggleSidebar,
    toggleRightPanel,
    setCommandPaletteOpen,
    commandPaletteOpen,
  ])
}
