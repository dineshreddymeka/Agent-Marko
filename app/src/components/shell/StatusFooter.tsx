import { useSettingsStore } from '@app/stores/settings'
import { useChatStore } from '@app/stores/chat'
import { cn } from '@app/lib/utils'

function ContextRing({ used, limit }: { used: number; limit: number }) {
  const pct = Math.min(100, Math.round((used / limit) * 100))
  const r = 8
  const circumference = 2 * Math.PI * r
  const offset = circumference - (pct / 100) * circumference
  const color =
    pct > 90 ? 'var(--color-danger)' : pct > 70 ? 'var(--color-attention)' : 'var(--color-accent)'

  return (
    <svg width="20" height="20" viewBox="0 0 20 20" className="shrink-0" aria-hidden>
      <circle cx="10" cy="10" r={r} fill="none" stroke="var(--color-border)" strokeWidth="2" />
      <circle
        cx="10"
        cy="10"
        r={r}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        transform="rotate(-90 10 10)"
        className={cn(pct > 90 && 'animate-pulse-ring')}
      />
    </svg>
  )
}

export function StatusFooter() {
  const model = useSettingsStore((s) => s.model)
  const contextUsage = useChatStore((s) => s.contextUsage)
  const runStatus = useChatStore((s) => s.runStatus)

  return (
    <footer className="flex h-[var(--footer-height)] shrink-0 items-center justify-between border-t border-border bg-canvas-subtle px-4 text-xs text-fg-muted">
      <div className="flex items-center gap-2">
        <span className="font-medium text-fg">{model}</span>
        {runStatus === 'running' && (
          <span className="rounded bg-accent-muted px-1.5 py-0.5 text-accent">Running</span>
        )}
      </div>
      <div className="flex items-center gap-2" title="Context usage">
        {contextUsage ? (
          <>
            <ContextRing used={contextUsage.used} limit={contextUsage.limit} />
            <span>
              {contextUsage.used.toLocaleString()} / {contextUsage.limit.toLocaleString()} tokens
            </span>
          </>
        ) : (
          <>
            <ContextRing used={0} limit={128000} />
            <span>— / 128k tokens</span>
          </>
        )}
      </div>
    </footer>
  )
}
