interface CronSchedulePickerProps {
  name?: string
  schedule?: string
  prompt?: string
  onAction?: (action: string, data: unknown) => void
}

export function CronSchedulePicker({
  name = '',
  schedule = '0 9 * * *',
  prompt = '',
  onAction,
}: CronSchedulePickerProps) {
  return (
    <div className="space-y-2 rounded-lg border border-border p-3">
      <input
        type="text"
        placeholder="Job name"
        defaultValue={name}
        className="w-full rounded border border-border bg-canvas px-2 py-1 text-sm text-fg"
      />
      <input
        type="text"
        placeholder="Cron schedule"
        defaultValue={schedule}
        className="w-full rounded border border-border bg-canvas px-2 py-1 font-mono text-sm text-fg"
      />
      <p className="text-xs text-fg-muted">e.g. 0 9 * * * = daily at 9am</p>
      <textarea
        placeholder="Agent prompt"
        defaultValue={prompt}
        rows={3}
        className="w-full rounded border border-border bg-canvas px-2 py-1 text-sm text-fg"
      />
      <button
        type="button"
        onClick={() => onAction?.('create_cron', { name, schedule, prompt })}
        className="rounded bg-accent px-3 py-1 text-xs text-white"
      >
        Create cron job
      </button>
    </div>
  )
}
