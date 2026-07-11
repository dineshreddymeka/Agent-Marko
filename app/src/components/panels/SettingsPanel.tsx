import { useEffect, useState } from 'react'
import { useSettingsStore } from '@app/stores/settings'
import { McpSubPanel } from '@app/components/panels/McpSubPanel'
import {
  fetchApprovalConfig,
  saveApprovalConfig,
  type ApprovalConfig,
} from '@app/lib/agui/client'
import { Moon, Sun, Monitor, ShieldCheck, X } from 'lucide-react'

export function SettingsPanel() {
  const [tab, setTab] = useState<'general' | 'approval' | 'mcp'>('general')
  const theme = useSettingsStore((s) => s.theme)
  const setTheme = useSettingsStore((s) => s.setTheme)
  const model = useSettingsStore((s) => s.model)
  const setModel = useSettingsStore((s) => s.setModel)
  const llmBaseUrl = useSettingsStore((s) => s.llmBaseUrl)
  const setLlmBaseUrl = useSettingsStore((s) => s.setLlmBaseUrl)
  const workspaceRoot = useSettingsStore((s) => s.workspaceRoot)
  const setWorkspaceRoot = useSettingsStore((s) => s.setWorkspaceRoot)

  const [approval, setApproval] = useState<ApprovalConfig | null>(null)
  const [approvalLoading, setApprovalLoading] = useState(false)

  useEffect(() => {
    if (tab !== 'approval') return
    setApprovalLoading(true)
    fetchApprovalConfig()
      .then(setApproval)
      .catch(() => setApproval(null))
      .finally(() => setApprovalLoading(false))
  }, [tab])

  const toggleAutoApprove = async (autoApproveAll: boolean) => {
    const next = await saveApprovalConfig({ autoApproveAll })
    setApproval(next)
  }

  const removeWhitelistedTool = async (toolName: string) => {
    if (!approval) return
    const next = await saveApprovalConfig({
      toolWhitelist: approval.toolWhitelist.filter((t) => t !== toolName),
    })
    setApproval(next)
  }

  return (
    <div className="p-4">
      <h2 className="mb-4 text-sm font-medium text-fg">Settings</h2>
      <div className="mb-4 flex gap-1 border-b border-border">
        {(['general', 'approval', 'mcp'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`px-3 py-1.5 text-xs capitalize ${
              tab === t
                ? 'border-b-2 border-accent text-accent'
                : 'text-fg-muted hover:text-fg'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'mcp' ? (
        <McpSubPanel />
      ) : tab === 'approval' ? (
        <div className="space-y-4 text-sm">
          <section className="rounded-lg border border-border p-3">
            <label className="flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                checked={approval?.autoApproveAll ?? false}
                disabled={approvalLoading || !approval}
                onChange={(e) => void toggleAutoApprove(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                <span className="flex items-center gap-1 font-medium text-fg">
                  <ShieldCheck size={14} className="text-success" />
                  Auto-approve all dangerous tools
                </span>
                <span className="mt-0.5 block text-xs text-fg-muted">
                  Skip approval prompts for run_shell, write_file, and other dangerous tools.
                </span>
              </span>
            </label>
          </section>

          <section>
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-fg-muted">
              Whitelisted tools
            </h3>
            {approvalLoading ? (
              <p className="text-xs text-fg-muted">Loading…</p>
            ) : approval?.toolWhitelist.length ? (
              <ul className="space-y-1">
                {approval.toolWhitelist.map((tool) => (
                  <li
                    key={tool}
                    className="flex items-center justify-between rounded border border-border px-2 py-1 font-mono text-xs"
                  >
                    {tool}
                    <button
                      type="button"
                      onClick={() => void removeWhitelistedTool(tool)}
                      className="text-fg-muted hover:text-danger"
                      aria-label={`Remove ${tool}`}
                    >
                      <X size={12} />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-fg-muted">
                No tools whitelisted. Use &quot;Always allow&quot; on an approval prompt, or add
                tools here after approving once.
              </p>
            )}
          </section>

          {approval?.sessionWhitelist.length ? (
            <section>
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-fg-muted">
                Sessions with always-allow ({approval.sessionWhitelist.length})
              </h3>
              <p className="text-xs text-fg-muted">
                Cleared when you restart the server unless persisted via approval prompts.
              </p>
            </section>
          ) : null}
        </div>
      ) : (
        <div className="space-y-4 text-sm">
          <section>
            <label className="mb-2 block text-xs text-fg-muted">Theme</label>
            <div className="flex gap-2">
              {([
                { id: 'dark' as const, icon: Moon, label: 'Dark' },
                { id: 'dim' as const, icon: Monitor, label: 'Dim' },
                { id: 'light' as const, icon: Sun, label: 'Light' },
              ]).map(({ id, icon: Icon, label }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setTheme(id)}
                  className={`flex items-center gap-1 rounded border px-3 py-1.5 text-xs ${
                    theme === id
                      ? 'border-accent bg-accent-muted text-accent'
                      : 'border-border text-fg hover:bg-canvas-subtle'
                  }`}
                >
                  <Icon size={14} /> {label}
                </button>
              ))}
            </div>
          </section>

          <section>
            <label className="mb-1 block text-xs text-fg-muted">Model</label>
            <input
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="w-full rounded border border-border bg-canvas px-3 py-1.5 text-fg"
            />
          </section>

          <section>
            <label className="mb-1 block text-xs text-fg-muted">LLM base URL</label>
            <input
              type="url"
              value={llmBaseUrl}
              onChange={(e) => setLlmBaseUrl(e.target.value)}
              placeholder="https://api.openai.com/v1"
              className="w-full rounded border border-border bg-canvas px-3 py-1.5 text-fg"
            />
          </section>

          <section>
            <label className="mb-1 block text-xs text-fg-muted">Workspace root</label>
            <input
              type="text"
              value={workspaceRoot}
              onChange={(e) => setWorkspaceRoot(e.target.value)}
              className="w-full rounded border border-border bg-canvas px-3 py-1.5 text-fg"
            />
          </section>
        </div>
      )}
    </div>
  )
}
