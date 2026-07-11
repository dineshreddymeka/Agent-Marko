interface MemoryEntryEditorProps {
  entryId?: string
  kind?: 'semantic' | 'episodic' | 'preference'
  content?: string
  onAction?: (action: string, data: unknown) => void
}

export function MemoryEntryEditor({
  entryId,
  kind = 'semantic',
  content = '',
  onAction,
}: MemoryEntryEditorProps) {
  return (
    <div className="space-y-2 rounded-lg border border-border p-3">
      <div className="flex gap-2">
        <select
          defaultValue={kind}
          className="rounded border border-border bg-canvas px-2 py-1 text-xs text-fg"
          onChange={(e) => onAction?.('change_kind', { kind: e.target.value })}
        >
          <option value="semantic">Semantic</option>
          <option value="episodic">Episodic</option>
          <option value="preference">Preference</option>
        </select>
        {entryId && <span className="text-xs text-fg-muted">ID: {entryId.slice(0, 8)}…</span>}
      </div>
      <textarea
        defaultValue={content}
        rows={4}
        className="w-full rounded border border-border bg-canvas px-2 py-1 text-sm text-fg"
        onChange={(e) => onAction?.('change_content', { content: e.target.value })}
      />
      <button
        type="button"
        onClick={() => onAction?.('save', { entryId, kind, content })}
        className="rounded bg-accent px-3 py-1 text-xs text-white"
      >
        Save memory
      </button>
    </div>
  )
}
