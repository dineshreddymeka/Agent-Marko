import { useQuery } from '@tanstack/react-query'
import { Play, Pause } from 'lucide-react'
import { apiClient } from '@app/lib/api'
import type { CronJob } from '@hermes/shared'
import { EmptyState } from '@app/components/common/EmptyState'
import { Skeleton } from '@app/components/common/Skeleton'
import { formatRelativeTime } from '@app/lib/utils'

export function CronPanel() {
  const { data: jobs, isLoading, refetch } = useQuery({
    queryKey: ['cron'],
    queryFn: () => apiClient.get<CronJob[]>('/api/cron'),
    retry: false,
  })

  const toggle = async (job: CronJob) => {
    await apiClient.patch(`/api/cron/${job.id}`, { enabled: !job.enabled })
    void refetch()
  }

  const runNow = async (job: CronJob) => {
    await apiClient.post(`/api/cron/${job.id}/run`)
  }

  if (isLoading) return <Skeleton className="m-4 h-20 w-full" />

  return (
    <div className="p-4">
      <h2 className="mb-4 text-sm font-medium text-fg">Cron jobs</h2>
      {!jobs?.length ? (
        <EmptyState title="No cron jobs" description="Ask the agent to schedule recurring tasks." />
      ) : (
        <ul className="space-y-2">
          {jobs.map((job) => (
            <li key={job.id} className="rounded-lg border border-border p-3">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-sm font-medium text-fg">{job.name}</h3>
                  <code className="text-xs text-fg-muted">{job.schedule}</code>
                </div>
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => void toggle(job)}
                    className="rounded p-1 text-fg-muted hover:bg-canvas-subtle"
                    title={job.enabled ? 'Disable' : 'Enable'}
                  >
                    {job.enabled ? <Pause size={14} /> : <Play size={14} />}
                  </button>
                  <button
                    type="button"
                    onClick={() => void runNow(job)}
                    className="rounded px-2 py-0.5 text-xs text-accent hover:bg-accent-muted"
                  >
                    Run now
                  </button>
                </div>
              </div>
              <p className="mt-1 truncate text-xs text-fg-muted">{job.prompt}</p>
              {job.lastRun && (
                <p className="mt-1 text-[10px] text-fg-subtle">
                  Last: {formatRelativeTime(job.lastRun)}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
