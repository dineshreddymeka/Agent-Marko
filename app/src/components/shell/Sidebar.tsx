import { PanelLeftClose, PanelLeftOpen, Plus } from 'lucide-react'
import { useNavigate } from '@tanstack/react-router'
import { SessionsPanel } from '@app/components/panels/SessionsPanel'
import { useUiStore } from '@app/stores/ui'
import { useSessionsStore } from '@app/stores/sessions'
import { generateId } from '@app/lib/utils'

export function Sidebar() {
  const sidebarOpen = useUiStore((s) => s.sidebarOpen)
  const toggleSidebar = useUiStore((s) => s.toggleSidebar)
  const addSession = useSessionsStore((s) => s.addSession)
  const setActiveSessionId = useSessionsStore((s) => s.setActiveSessionId)
  const navigate = useNavigate()

  const newSession = () => {
    const id = generateId()
    addSession({
      id,
      title: 'New chat',
      groupName: null,
      profileId: null,
      pinned: false,
      archived: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    setActiveSessionId(id)
    void navigate({ to: '/session/$id', params: { id } })
  }

  return (
    <aside
      aria-label="Sessions"
      className={[
        'flex shrink-0 flex-col border-r border-border bg-canvas-subtle transition-shell overflow-hidden',
        'max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-40 max-md:shadow-xl max-md:pb-14',
        sidebarOpen ? 'w-[280px] opacity-100' : 'w-0 opacity-0 max-md:pointer-events-none border-r-0',
      ].join(' ')}
    >
      <div className="flex h-12 items-center justify-between border-b border-border px-3">
        <span className="text-sm font-medium text-fg">Sessions</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            title="New session"
            aria-label="New session"
            onClick={newSession}
            className="flex h-7 w-7 items-center justify-center rounded-md text-fg-muted hover:bg-canvas hover:text-fg"
          >
            <Plus size={16} />
          </button>
          <button
            type="button"
            title="Toggle sidebar (Ctrl+B)"
            aria-label="Toggle sidebar"
            onClick={toggleSidebar}
            className="flex h-7 w-7 items-center justify-center rounded-md text-fg-muted hover:bg-canvas hover:text-fg"
          >
            {sidebarOpen ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <SessionsPanel compact />
      </div>
    </aside>
  )
}
