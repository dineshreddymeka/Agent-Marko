import { useChatStore } from '@app/stores/chat'

interface ContextRingProps {
  used?: number
  max?: number
}

export function ContextRing({ used = 0, max = 128_000 }: ContextRingProps) {
  const pct = max > 0 ? Math.min(used / max, 1) : 0
  const radius = 7
  const circumference = 2 * Math.PI * radius
  const offset = circumference * (1 - pct)

  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 18 18"
      aria-label={`Context usage ${Math.round(pct * 100)}%`}
      role="img"
    >
      <circle
        cx="9"
        cy="9"
        r={radius}
        fill="none"
        stroke="var(--color-border)"
        strokeWidth="2"
      />
      <circle
        cx="9"
        cy="9"
        r={radius}
        fill="none"
        stroke="var(--color-accent)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        transform="rotate(-90 9 9)"
      />
    </svg>
  )
}

export function StatusFooter() {
  const contextUsage = useChatStore((s) => s.contextUsage)
  const model = 'hermes-3-llama-3.1-8b'
  const tokensUsed = contextUsage?.used ?? 0
  const tokensMax = contextUsage?.limit ?? 128_000

  return (
    <footer className="flex h-8 shrink-0 items-center justify-between border-t border-border bg-canvas-subtle px-3 text-xs text-fg-muted">
      <span className="font-mono">{model}</span>
      <div className="flex items-center gap-2">
        <ContextRing used={tokensUsed} max={tokensMax} />
        <span>
          {tokensUsed.toLocaleString()} / {tokensMax.toLocaleString()} tokens
        </span>
      </div>
    </footer>
  )
}
