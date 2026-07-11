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

const items: {
  id: PanelName | 'chat'
  icon: typeof MessageSquare
  label: string
  to: string
}[] = [
  { id: 'chat', icon: MessageSquare, label: 'Chat', to: '/' },
  { id: 'workspace', icon: FolderOpen, label: 'Workspace', to: '/panel/workspace' },
  { id: 'skills', icon: Sparkles, label: 'Skills', to: '/panel/skills' },
  { id: 'memory', icon: Brain, label: 'Memory', to: '/panel/memory' },
  { id: 'cron', icon: Clock, label: 'Cron', to: '/panel/cron' },
  { id: 'settings', icon: Settings, label: 'Settings', to: '/panel/settings' },
]

export function MobileNav() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })

  return (
    <nav
      aria-label="Mobile navigation"
      className="fixed inset-x-0 bottom-0 z-50 flex border-t border-border bg-rail pb-[env(safe-area-inset-bottom)] md:hidden"
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
            aria-label={label}
            className={[
              'flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[10px]',
              active ? 'text-accent' : 'text-fg-muted',
            ].join(' ')}
          >
            <Icon size={20} strokeWidth={1.75} />
            <span>{label}</span>
          </Link>
        )
      })}
    </nav>
  )
}
