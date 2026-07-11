import { PanelRightClose, PanelRight } from 'lucide-react'
import { useUiStore } from '@app/stores/ui'
import { AgentStatePanel } from '@app/components/state/AgentStatePanel'
import { cn } from '@app/lib/utils'

export function RightPanel() {
  const open = useUiStore((s) => s.rightPanelOpen)
  const toggle = useUiStore((s) => s.toggleRightPanel)

  return (
    <aside
      className={cn(
        'flex shrink-0 flex-col border-l border-border bg-canvas-subtle transition-[width] duration-150 ease-out',
        open ? 'w-[var(--right-panel-width)]' : 'w-0 overflow-hidden border-l-0',
        'max-md:fixed max-md:inset-y-0 max-md:right-0 max-md:z-40 max-md:shadow-xl',
      )}
    >
      <div className="flex h-10 items-center justify-between border-b border-border px-3">
        <span className="text-xs font-medium uppercase tracking-wide text-fg-muted">
          Agent state
        </span>
        <button
          type="button"
          onClick={toggle}
          className="rounded p-1 text-fg-muted hover:bg-canvas-inset hover:text-fg"
          title="Toggle right panel (Ctrl+Alt+B)"
        >
          {open ? <PanelRightClose size={16} /> : <PanelRight size={16} />}
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        <AgentStatePanel />
      </div>
    </aside>
  )
}
