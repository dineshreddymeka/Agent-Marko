import { Moon, Sun, SunDim } from 'lucide-react'
import { Outlet } from '@tanstack/react-router'
import { IconRail } from '@app/components/shell/IconRail'
import { Sidebar } from '@app/components/shell/Sidebar'
import { RightPanel } from '@app/components/shell/RightPanel'
import { MobileNav } from '@app/components/shell/MobileNav'
import { StatusFooter } from '@app/components/shell/StatusFooter'
import { AgentStatePanel } from '@app/components/state/AgentStatePanel'
import { CommandPalette } from '@app/components/common/CommandPalette'
import { Toasts } from '@app/components/common/Toasts'
import { ErrorBoundary } from '@app/components/common/ErrorBoundary'
import { useKeyboardShortcuts } from '@app/hooks/useKeyboardShortcuts'
import { useUiStore, type Theme } from '@app/stores/ui'

const themeIcons: Record<Theme, typeof Moon> = {
  dark: Moon,
  dim: SunDim,
  light: Sun,
}

export function AppShell() {
  useKeyboardShortcuts()

  const theme = useUiStore((s) => s.theme)
  const cycleTheme = useUiStore((s) => s.cycleTheme)
  const sidebarOpen = useUiStore((s) => s.sidebarOpen)
  const setSidebarOpen = useUiStore((s) => s.setSidebarOpen)
  const rightPanelOpen = useUiStore((s) => s.rightPanelOpen)
  const setRightPanelOpen = useUiStore((s) => s.setRightPanelOpen)

  const ThemeIcon = themeIcons[theme]

  return (
    <ErrorBoundary>
      <div className="flex h-full flex-col pb-14 md:pb-0">
        <div className="relative flex min-h-0 flex-1">
          <IconRail />

          {!sidebarOpen && (
            <button
              type="button"
              title="Show sidebar (Ctrl+B)"
              aria-label="Show sidebar"
              onClick={() => setSidebarOpen(true)}
              className="absolute left-2 top-2 z-10 rounded-md border border-border bg-canvas-subtle px-2 py-1 text-xs text-fg-muted hover:text-fg md:left-12"
            >
              Sidebar
            </button>
          )}

          {sidebarOpen ? (
            <button
              type="button"
              aria-label="Close sidebar"
              className="fixed inset-0 z-30 bg-black/40 md:hidden"
              onClick={() => setSidebarOpen(false)}
            />
          ) : null}

          <Sidebar />

          <Outlet />

          {rightPanelOpen ? (
            <button
              type="button"
              aria-label="Close right panel"
              className="fixed inset-0 z-30 bg-black/40 md:hidden"
              onClick={() => setRightPanelOpen(false)}
            />
          ) : null}

          <RightPanel title="Agent state">
            <AgentStatePanel />
          </RightPanel>
        </div>

        <div className="relative">
          <StatusFooter />
          <button
            type="button"
            title={`Theme: ${theme} (click to cycle)`}
            aria-label={`Current theme: ${theme}. Click to cycle.`}
            onClick={cycleTheme}
            className="absolute right-3 flex h-6 w-6 items-center justify-center rounded text-fg-muted hover:bg-canvas hover:text-fg"
          >
            <ThemeIcon size={14} />
          </button>
        </div>

        <MobileNav />
        <CommandPalette />
        <Toasts />
      </div>
    </ErrorBoundary>
  )
}
