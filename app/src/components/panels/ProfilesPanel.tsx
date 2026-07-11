import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@app/lib/api'
import type { Profile } from '@hermes/shared'
import { useSettingsStore } from '@app/stores/settings'
import { EmptyState } from '@app/components/common/EmptyState'
import { Skeleton } from '@app/components/common/Skeleton'

export function ProfilesPanel() {
  const setModel = useSettingsStore((s) => s.setModel)

  const { data: profiles, isLoading } = useQuery({
    queryKey: ['profiles'],
    queryFn: () => apiClient.get<Profile[]>('/api/profiles'),
    retry: false,
  })

  if (isLoading) return <Skeleton className="m-4 h-20 w-full" />

  return (
    <div className="p-4">
      <h2 className="mb-4 text-sm font-medium text-fg">Profiles</h2>
      {!profiles?.length ? (
        <EmptyState title="No profiles" description="Create agent profiles with custom prompts." />
      ) : (
        <ul className="space-y-2">
          {profiles.map((profile) => (
            <li key={profile.id} className="rounded-lg border border-border p-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium text-fg">{profile.name}</h3>
                <button
                  type="button"
                  onClick={() => setModel(profile.model)}
                  className="text-xs text-accent hover:underline"
                >
                  Use model
                </button>
              </div>
              <p className="mt-1 text-xs text-fg-muted">
                {profile.model} · {profile.provider} · temp {profile.temperature}
              </p>
              <p className="mt-2 line-clamp-2 text-xs text-fg-subtle">{profile.systemPrompt}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
