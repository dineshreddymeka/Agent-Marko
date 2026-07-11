import { useState } from 'react'
import { ChevronDown, ChevronRight, Wrench, Loader2, CheckCircle, XCircle } from 'lucide-react'
import type { ToolCallState } from '@app/stores/chat'
import { cn } from '@app/lib/utils'

interface ToolCallCardProps {
  toolCall: ToolCallState
}

const statusIcons = {
  pending: Loader2,
  'streaming-args': Loader2,
  executing: Loader2,
  done: CheckCircle,
  error: XCircle,
}

export function ToolCallCard({ toolCall }: ToolCallCardProps) {
  const [open, setOpen] = useState(toolCall.status !== 'done')
  const Icon = statusIcons[toolCall.status]
  const spinning = ['pending', 'streaming-args', 'executing'].includes(toolCall.status)

  return (
    <div className="my-2 overflow-hidden rounded-lg border border-border bg-canvas-inset text-sm">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-canvas-subtle"
      >
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <Wrench size={14} className="text-fg-muted" />
        <span className="font-medium text-fg">{toolCall.name || 'Tool'}</span>
        <Icon
          size={14}
          className={cn(
            'ml-auto',
            toolCall.status === 'done' && 'text-success',
            toolCall.status === 'error' && 'text-danger',
            spinning && 'animate-spin text-fg-muted',
          )}
        />
      </button>
      {open && (
        <div className="border-t border-border px-3 py-2">
          {toolCall.args && (
            <div className="mb-2">
              <p className="mb-1 text-xs text-fg-muted">Arguments</p>
              <pre className="overflow-x-auto rounded bg-canvas-subtle p-2 font-mono text-xs">
                {toolCall.args}
              </pre>
            </div>
          )}
          {toolCall.result != null && (
            <div>
              <p className="mb-1 text-xs text-fg-muted">Result</p>
              <pre className="max-h-48 overflow-auto rounded bg-canvas-subtle p-2 font-mono text-xs">
                {typeof toolCall.result === 'string'
                  ? toolCall.result
                  : JSON.stringify(toolCall.result, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
