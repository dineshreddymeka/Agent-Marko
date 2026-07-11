import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Plus, Plug } from 'lucide-react'
import { apiClient } from '@app/lib/api'
import type { McpServer } from '@app/types/hermes'
import { EmptyState } from '@app/components/common/EmptyState'
import { Skeleton } from '@app/components/common/Skeleton'

export function McpSubPanel() {
  const { data: servers, isLoading, refetch } = useQuery({
    queryKey: ['mcp-servers'],
    queryFn: () => apiClient.get<McpServer[]>('/api/settings/mcp'),
    retry: false,
  })

  const [showForm, setShowForm] = useState(false)

  if (isLoading) return <Skeleton className="h-20 w-full" />

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-fg-muted">Model Context Protocol servers</p>
        <button
          type="button"
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-1 text-xs text-accent hover:underline"
        >
          <Plus size={12} /> Add server
        </button>
      </div>

      {showForm && <McpServerForm onSaved={() => { setShowForm(false); void refetch() }} />}

      {!servers?.length ? (
        <EmptyState title="No MCP servers" description="Add stdio or HTTP MCP servers." />
      ) : (
        <ul className="space-y-2">
          {servers.map((server) => (
            <li key={server.id} className="rounded-lg border border-border p-3 text-sm">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Plug size={14} className={server.enabled ? 'text-success' : 'text-fg-muted'} />
                  <span className="font-medium text-fg">{server.name}</span>
                  <span className="text-xs text-fg-muted">{server.transport}</span>
                </div>
                <span
                  className={`text-xs ${server.enabled ? 'text-success' : 'text-fg-muted'}`}
                >
                  {server.enabled ? 'Connected' : 'Disabled'}
                </span>
              </div>
              <p className="mt-1 truncate font-mono text-xs text-fg-subtle">
                {server.command ?? server.url}
              </p>
              <button
                type="button"
                onClick={() => void apiClient.post(`/api/settings/mcp/${server.id}/test`)}
                className="mt-2 text-xs text-accent hover:underline"
              >
                Test connection
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function McpServerForm({ onSaved }: { onSaved: () => void }) {
  const [name, setName] = useState('')
  const [transport, setTransport] = useState<'stdio' | 'http'>('stdio')
  const [command, setCommand] = useState('')
  const [url, setUrl] = useState('')

  const save = async () => {
    await apiClient.post('/api/settings/mcp', {
      name,
      transport,
      command: transport === 'stdio' ? command : null,
      url: transport === 'http' ? url : null,
      enabled: true,
    })
    onSaved()
  }

  return (
    <div className="space-y-2 rounded-lg border border-border p-3">
      <input
        type="text"
        placeholder="Server name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="w-full rounded border border-border bg-canvas px-2 py-1 text-sm text-fg"
      />
      <select
        value={transport}
        onChange={(e) => setTransport(e.target.value as 'stdio' | 'http')}
        className="w-full rounded border border-border bg-canvas px-2 py-1 text-sm text-fg"
      >
        <option value="stdio">stdio</option>
        <option value="http">HTTP</option>
      </select>
      {transport === 'stdio' ? (
        <input
          type="text"
          placeholder="Command"
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          className="w-full rounded border border-border bg-canvas px-2 py-1 font-mono text-sm text-fg"
        />
      ) : (
        <input
          type="url"
          placeholder="URL"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          className="w-full rounded border border-border bg-canvas px-2 py-1 text-sm text-fg"
        />
      )}
      <button
        type="button"
        onClick={() => void save()}
        className="rounded bg-accent px-3 py-1 text-xs text-white"
      >
        Save
      </button>
    </div>
  )
}
