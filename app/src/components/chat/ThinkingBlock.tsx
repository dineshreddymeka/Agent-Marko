import { useState } from 'react'
import { Brain, ChevronDown, ChevronRight } from 'lucide-react'

interface ThinkingBlockProps {
  content: string
}

export function ThinkingBlock({ content }: ThinkingBlockProps) {
  const [open, setOpen] = useState(false)

  if (!content.trim()) return null

  return (
    <div className="mb-2 overflow-hidden rounded-lg border border-border-muted bg-canvas-inset text-sm">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-fg-muted hover:text-fg"
      >
        <Brain size={14} />
        <span className="text-xs">Thinking</span>
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
      </button>
      {open && (
        <div className="border-t border-border-muted px-3 py-2 font-mono text-xs text-fg-muted">
          {content}
        </div>
      )}
    </div>
  )
}
