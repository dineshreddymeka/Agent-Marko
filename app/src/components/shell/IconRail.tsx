import { Link, useRouterState } from '@tanstack/react-router'
import {
  MessageSquare,
  FolderOpen,
  Sparkles,
  Brain,
  Clock,
  Settings,
  User,
} from 'lucide-react'
import { cn } from '@app/lib/utils'
import { useUiStore, type PanelName } from '@app/stores/ui'

const items: { panel: PanelName | 'chat'; icon: typeof MessageSquare; label: string; to: string }[] = [
  { panel: 'chat', icon: MessageSquare, label: 'Chat', to: '/' },
  { panel: 'workspace', icon: FolderOpen, label: 'Workspace', to: '/panel/workspace' },
  { panel: 'skills', icon: Sparkles, label: 'Skills', to: '/panel/skills' },
  { panel: 'memory', icon: Brain, label: 'Memory', to: '/panel/memory' },
  { panel: 'cron', icon: Clock, label: 'Cron', to: '/panel/cron' },
  { panel: 'profiles', icon: User, label: 'Profiles', to: '/panel/profiles' },
  { panel: 'settings', icon: Settings, label: 'Settings', to: '/panel/settings' },
]

export function IconRail() {
  const setActivePanel = useUiStore((s) => s.setActivePanel)
  const pathname = useRouterState({ select: (s) => s.location.pathname })

  return (
    <nav
      className="hidden w-[var(--rail-width)] shrink-0 flex-col items-center gap-1 border-r border-border bg-canvas-subtle py-2 md:flex"
      aria-label="Main navigation"
    >
      {items.map(({ panel, icon: Icon, label, to }) => {
        const active =
          panel === 'chat'
            ? pathname === '/' || pathname.startsWith('/session/')
            : pathname === to
        return (
          <Link
            key={label}
            to={to}
            onClick={() => panel !== 'chat' && setActivePanel(panel)}
            title={label}
            className={cn(
              'flex h-10 w-10 items-center justify-center rounded-md transition-colors duration-150',
              active
                ? 'bg-accent-muted text-accent'
                : 'text-fg-muted hover:bg-canvas-inset hover:text-fg',
            )}
          >
            <Icon size={20} />
          </Link>
        )
      })}
    </nav>
  )
}
