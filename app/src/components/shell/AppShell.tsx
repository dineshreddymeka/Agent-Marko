import { useEffect } from 'react'
import { Outlet } from '@tanstack/react-router'
import { IconRail } from '@app/components/shell/IconRail'
import { Sidebar } from '@app/components/shell/Sidebar'
import { RightPanel } from '@app/components/shell/RightPanel'
import { StatusFooter } from '@app/components/shell/StatusFooter'
import { CommandPalette } from '@app/components/common/CommandPalette'
import { Toasts } from '@app/components/common/Toasts'
import { useUiStore } from '@app/stores/ui'

export function AppShell() {
  const setCommandPaletteOpen = useUiStore((s) => s.setCommandPaletteOpen)
  const toggleSidebar = useUiStore((s) => s.toggleSidebar)
  const toggleRightPanel = useUiStore((s) => s.toggleRightPanel)

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault()
        setCommandPaletteOpen(true)
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'b' && !e.altKey) {
        e.preventDefault()
        toggleSidebar()
      }
      if ((e.ctrlKey || e.metaKey) && e.altKey && e.key === 'b') {
        e.preventDefault()
        toggleRightPanel()
      }
      if (e.key === 'Escape') {
        setCommandPaletteOpen(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [setCommandPaletteOpen, toggleSidebar, toggleRightPanel])

  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-0 flex-1">
        <IconRail />
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <Outlet />
        </div>
        <RightPanel />
      </div>
      <StatusFooter />
      <CommandPalette />
      <Toasts />
      {/* Mobile bottom nav */}
      <nav className="flex border-t border-border bg-canvas-subtle md:hidden">
        <MobileNav />
      </nav>
    </div>
  )
}

function MobileNav() {
  const setActivePanel = useUiStore((s) => s.setActivePanel)
  const items = [
    { label: 'Chat', panel: null },
    { label: 'Sessions', panel: 'sessions' as const },
    { label: 'Settings', panel: 'settings' as const },
  ]
  return (
    <>
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          className="flex-1 py-3 text-center text-xs text-fg-muted"
          onClick={() => item.panel && setActivePanel(item.panel)}
        >
          {item.label}
        </button>
      ))}
    </>
  )
}
