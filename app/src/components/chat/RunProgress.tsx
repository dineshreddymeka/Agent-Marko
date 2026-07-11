import { Loader2, X } from 'lucide-react'
import { useChatStore } from '@app/stores/chat'
import { cancelRun } from '@app/lib/agui/client'

export function RunProgress() {
  const runStatus = useChatStore((s) => s.runStatus)
  const runSteps = useChatStore((s) => s.runSteps)

  if (runStatus !== 'running') return null

  return (
    <div className="flex items-center gap-2 border-t border-border px-4 py-2 text-xs text-fg-muted">
      <Loader2 size={14} className="animate-spin text-accent" />
      <span>Agent running…</span>
      {runSteps.map((step) => (
        <span
          key={step.id}
          className={`rounded px-1.5 py-0.5 ${
            step.status === 'done'
              ? 'bg-success/20 text-success'
              : 'bg-accent-muted text-accent'
          }`}
        >
          {step.name}
        </span>
      ))}
      <button
        type="button"
        onClick={cancelRun}
        className="ml-auto flex items-center gap-1 rounded px-2 py-0.5 hover:bg-canvas-subtle"
        title="Cancel (Esc)"
      >
        <X size={12} /> Cancel
      </button>
    </div>
  )
}
