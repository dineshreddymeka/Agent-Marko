import { ShieldAlert } from 'lucide-react'
import { respondToApproval, type ApprovalDecision } from '@app/lib/agui/client'
import type { PendingApproval } from '@app/stores/chat'

interface ApprovalCardProps {
  approval: PendingApproval
}

export function ApprovalCard({ approval }: ApprovalCardProps) {
  const act = (decision: ApprovalDecision) => {
    void respondToApproval(decision, approval.toolCallId)
  }

  return (
    <div className="mx-auto max-w-3xl border-t border-attention/30 bg-attention/10 px-4 py-3">
      <div className="flex items-start gap-3">
        <ShieldAlert className="mt-0.5 shrink-0 text-attention" size={18} />
        <div className="flex-1">
          <p className="text-sm font-medium text-fg">
            Approve tool call: <code className="text-accent">{approval.toolName}</code>
          </p>
          <pre className="mt-1 max-h-24 overflow-auto rounded bg-canvas-subtle p-2 font-mono text-xs text-fg-muted">
            {JSON.stringify(approval.args, null, 2)}
          </pre>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => act('approve')}
              className="rounded-md bg-success px-3 py-1 text-xs text-white hover:opacity-90"
            >
              Approve
            </button>
            <button
              type="button"
              onClick={() => act('reject')}
              className="rounded-md bg-danger px-3 py-1 text-xs text-white hover:opacity-90"
            >
              Reject
            </button>
            <button
              type="button"
              onClick={() => act('always')}
              className="rounded-md border border-border px-3 py-1 text-xs text-fg hover:bg-canvas-subtle"
            >
              Always allow this session
            </button>
            <button
              type="button"
              onClick={() => act('always_tool')}
              className="rounded-md border border-border px-3 py-1 text-xs text-fg hover:bg-canvas-subtle"
            >
              Always allow <code className="text-accent">{approval.toolName}</code>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
