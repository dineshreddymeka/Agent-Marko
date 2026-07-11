import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Pin, Archive, Trash2 } from 'lucide-react'
import { apiClient } from '@app/lib/api'
import { useSessionsStore } from '@app/stores/sessions'
import { formatRelativeTime } from '@app/lib/utils'
import type { Session } from '@hermes/shared'
import { EmptyState } from '@app/components/common/EmptyState'
import { Skeleton } from '@app/components/common/Skeleton'

interface SessionsPanelProps {
  compact?: boolean
}

export function SessionsPanel({ compact }: SessionsPanelProps) {
  const sessions = useSessionsStore((s) => s.sessions)
  const setSessions = useSessionsStore((s) => s.setSessions)
  const activeId = useSessionsStore((s) => s.activeSessionId)
  const setActiveSessionId = useSessionsStore((s) => s.setActiveSessionId)
  const updateSession = useSessionsStore((s) => s.updateSession)
  const removeSession = useSessionsStore((s) => s.removeSession)

  const { isLoading } = useQuery({
    queryKey: ['sessions'],
    queryFn: async () => {
      const data = await apiClient.get<Session[]>('/api/sessions')
      setSessions(data)
      return data
    },
    retry: false,
  })

  const list = sessions.filter((s) => !s.archived)

  if (isLoading && list.length === 0) {
    return (
      <div className="space-y-2 p-3">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-3/4" />
      </div>
    )
  }

  if (list.length === 0) {
    return (
      <EmptyState
        title="No sessions"
        description="Start a new chat to create one."
        className="py-8"
      />
    )
  }

  return (
    <ul className="divide-y divide-border">
      {list.map((session) => (
        <li key={session.id}>
          <Link
            to="/session/$id"
            params={{ id: session.id }}
            onClick={() => setActiveSessionId(session.id)}
            className={`flex items-center gap-2 px-3 py-2 text-sm hover:bg-canvas-inset ${
              activeId === session.id ? 'bg-accent-muted text-accent' : 'text-fg'
            }`}
          >
            <span className="min-w-0 flex-1 truncate">{session.title}</span>
            {!compact && (
              <span className="text-xs text-fg-muted">
                {formatRelativeTime(session.updatedAt)}
              </span>
            )}
            {session.pinned && <Pin size={12} className="shrink-0 text-fg-muted" />}
          </Link>
          {!compact && (
            <div className="flex gap-1 px-3 pb-2">
              <button
                type="button"
                title="Pin"
                onClick={() => updateSession(session.id, { pinned: !session.pinned })}
                className="rounded p-1 text-fg-muted hover:bg-canvas-subtle"
              >
                <Pin size={12} />
              </button>
              <button
                type="button"
                title="Archive"
                onClick={() => updateSession(session.id, { archived: true })}
                className="rounded p-1 text-fg-muted hover:bg-canvas-subtle"
              >
                <Archive size={12} />
              </button>
              <button
                type="button"
                title="Delete"
                onClick={() => {
                  removeSession(session.id)
                  void apiClient.delete(`/api/sessions/${session.id}`)
                }}
                className="rounded p-1 text-fg-muted hover:text-danger"
              >
                <Trash2 size={12} />
              </button>
            </div>
          )}
        </li>
      ))}
    </ul>
  )
}
