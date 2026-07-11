interface SkillCardProps {
  name: string
  description?: string
  usageCount?: number
  onAction?: (action: string, data: unknown) => void
}

export function SkillCard({ name, description, usageCount, onAction }: SkillCardProps) {
  return (
    <div className="rounded-lg border border-border bg-canvas-subtle p-3">
      <div className="flex items-start justify-between">
        <div>
          <h4 className="text-sm font-medium text-fg">{name}</h4>
          {description && <p className="mt-1 text-xs text-fg-muted">{description}</p>}
        </div>
        {usageCount != null && (
          <span className="rounded bg-accent-muted px-1.5 py-0.5 text-xs text-accent">
            {usageCount} uses
          </span>
        )}
      </div>
      <button
        type="button"
        onClick={() => onAction?.('use_skill', { name })}
        className="mt-2 text-xs text-accent hover:underline"
      >
        Use skill
      </button>
    </div>
  )
}
