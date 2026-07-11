import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { apiClient } from '@app/lib/api'
import type { MemoryEntry } from '@hermes/shared'
import { EmptyState } from '@app/components/common/EmptyState'
import { Skeleton } from '@app/components/common/Skeleton'

export function MemoryPanel() {
  const [kind, setKind] = useState<string>('all')
  const [query, setQuery] = useState('')

  const { data: entries, isLoading } = useQuery({
    queryKey: ['memory', kind],
    queryFn: () =>
      apiClient.get<MemoryEntry[]>('/api/memory', kind !== 'all' ? { kind } : undefined),
    retry: false,
  })

  const { data: searchResults } = useQuery({
    queryKey: ['memory-search', query],
    queryFn: () => apiClient.get<MemoryEntry[]>('/api/search', { q: query, type: 'memory' }),
    enabled: query.length > 2,
    retry: false,
  })

  const list = query.length > 2 ? searchResults : entries

  return (
    <div className="p-4">
      <h2 className="mb-4 text-sm font-medium text-fg">Memory</h2>
      <div className="mb-4 flex gap-2">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-2 top-2 text-fg-muted" />
          <input
            type="text"
            placeholder="What does the agent know about…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full rounded border border-border bg-canvas py-1.5 pl-7 pr-2 text-sm text-fg"
          />
        </div>
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value)}
          className="rounded border border-border bg-canvas px-2 text-sm text-fg"
        >
          <option value="all">All kinds</option>
          <option value="semantic">Semantic</option>
          <option value="episodic">Episodic</option>
          <option value="preference">Preference</option>
        </select>
      </div>
      {isLoading ? (
        <Skeleton className="h-20 w-full" />
      ) : !list?.length ? (
        <EmptyState title="No memories" description="The agent hasn't stored any memories yet." />
      ) : (
        <ul className="space-y-2">
          {list.map((entry) => (
            <li key={entry.id} className="rounded-lg border border-border p-3 text-sm">
              <div className="mb-1 flex items-center gap-2">
                <span className="rounded bg-accent-muted px-1.5 py-0.5 text-[10px] text-accent">
                  {entry.kind}
                </span>
                <span className="text-xs text-fg-muted">
                  importance: {entry.importance.toFixed(1)}
                </span>
              </div>
              <p className="text-fg">{entry.content}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
