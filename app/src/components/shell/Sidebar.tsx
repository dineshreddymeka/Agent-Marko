import { PanelLeftClose, PanelLeft } from 'lucide-react'
import { useUiStore } from '@app/stores/ui'
import { SessionsPanel } from '@app/components/panels/SessionsPanel'
import { cn } from '@app/lib/utils'

export function Sidebar() {
  const open = useUiStore((s) => s.sidebarOpen)
  const toggle = useUiStore((s) => s.toggleSidebar)

  return (
    <aside
      className={cn(
        'flex shrink-0 flex-col border-r border-border bg-canvas-subtle transition-[width] duration-150 ease-out',
        open ? 'w-[var(--sidebar-width)]' : 'w-0 overflow-hidden border-r-0',
        'max-md:fixed max-md:inset-y-0 max-md:left-[var(--rail-width)] max-md:z-40 max-md:shadow-xl',
      )}
    >
      <div className="flex h-10 items-center justify-between border-b border-border px-3">
        <span className="text-xs font-medium uppercase tracking-wide text-fg-muted">
          Sessions
        </span>
        <button
          type="button"
          onClick={toggle}
          className="rounded p-1 text-fg-muted hover:bg-canvas-inset hover:text-fg"
          title="Toggle sidebar (Ctrl+B)"
        >
          {open ? <PanelLeftClose size={16} /> : <PanelLeft size={16} />}
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        <SessionsPanel compact />
      </div>
    </aside>
  )
}
