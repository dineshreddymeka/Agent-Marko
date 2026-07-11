import {
  Brain,
  Clock,
  FolderOpen,
  MessageSquare,
  Settings,
  Sparkles,
} from 'lucide-react'
import { Link, useRouterState } from '@tanstack/react-router'
import type { PanelName } from '@app/stores/ui'
import { useUiStore } from '@app/stores/ui'

const items: { id: PanelName | 'chat'; icon: typeof MessageSquare; label: string; to: string }[] =
  [
    { id: 'chat', icon: MessageSquare, label: 'Chat', to: '/' },
    { id: 'workspace', icon: FolderOpen, label: 'Workspace', to: '/panel/workspace' },
    { id: 'skills', icon: Sparkles, label: 'Skills', to: '/panel/skills' },
    { id: 'memory', icon: Brain, label: 'Memory', to: '/panel/memory' },
    { id: 'cron', icon: Clock, label: 'Cron', to: '/panel/cron' },
    { id: 'settings', icon: Settings, label: 'Settings', to: '/panel/settings' },
  ]

export function IconRail() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const setActivePanel = useUiStore((s) => s.setActivePanel)

  return (
    <nav
      aria-label="Main navigation"
      className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-border bg-rail py-2 max-md:hidden"
    >
      {items.map(({ id, icon: Icon, label, to }) => {
        const active =
          id === 'chat'
            ? pathname === '/' || pathname.startsWith('/session/')
            : pathname === to

        return (
          <Link
            key={id}
            to={to}
            title={label}
            aria-label={label}
            onClick={() => setActivePanel(id === 'chat' ? null : id)}
            className={[
              'flex h-10 w-10 items-center justify-center rounded-md transition-shell',
              active
                ? 'bg-accent-muted text-accent'
                : 'text-fg-muted hover:bg-canvas-subtle hover:text-fg',
            ].join(' ')}
          >
            <Icon size={18} strokeWidth={1.75} />
          </Link>
        )
      })}
    </nav>
  )
}
