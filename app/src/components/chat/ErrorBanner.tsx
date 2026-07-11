import { AlertCircle, RotateCcw } from 'lucide-react'
import { useChatStore } from '@app/stores/chat'

export function ErrorBanner() {
  const error = useChatStore((s) => s.error)
  const setError = useChatStore((s) => s.setError)
  const setRunStatus = useChatStore((s) => s.setRunStatus)

  if (!error) return null

  return (
    <div className="flex items-center gap-2 border-t border-danger/30 bg-danger/10 px-4 py-2 text-sm text-danger">
      <AlertCircle size={16} />
      <span className="flex-1">{error}</span>
      <button
        type="button"
        onClick={() => {
          setError(null)
          setRunStatus('idle')
        }}
        className="flex items-center gap-1 rounded px-2 py-0.5 text-xs hover:bg-danger/20"
      >
        <RotateCcw size={12} /> Dismiss
      </button>
    </div>
  )
}
