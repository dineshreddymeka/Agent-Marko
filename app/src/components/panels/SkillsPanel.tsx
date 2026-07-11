import { useQuery } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import { apiClient } from '@app/lib/api'
import type { Skill } from '@hermes/shared'
import { EmptyState } from '@app/components/common/EmptyState'
import { Skeleton } from '@app/components/common/Skeleton'

export function SkillsPanel() {
  const { data: skills, isLoading, refetch } = useQuery({
    queryKey: ['skills'],
    queryFn: () => apiClient.get<Skill[]>('/api/skills'),
    retry: false,
  })

  const sync = () => {
    void apiClient.post('/api/skills/sync')
    void refetch()
  }

  if (isLoading) {
    return (
      <div className="space-y-2 p-4">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    )
  }

  return (
    <div className="p-4">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-medium text-fg">Skills</h2>
        <button
          type="button"
          onClick={sync}
          className="flex items-center gap-1 rounded border border-border px-2 py-1 text-xs text-fg hover:bg-canvas-subtle"
        >
          <RefreshCw size={12} /> Sync
        </button>
      </div>
      {!skills?.length ? (
        <EmptyState title="No skills" description="Add SKILL.md folders or sync from git." />
      ) : (
        <ul className="space-y-2">
          {skills.map((skill) => (
            <li key={skill.id} className="rounded-lg border border-border p-3">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-sm font-medium text-fg">{skill.name}</h3>
                  <p className="text-xs text-fg-muted">{skill.description}</p>
                </div>
                <span className="rounded bg-canvas-inset px-1.5 py-0.5 text-[10px] text-fg-muted">
                  {skill.source}
                </span>
              </div>
              <p className="mt-2 text-xs text-fg-muted">
                {skill.usageCount} uses · {skill.successCount} successes
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
