import { useRef, useState, useCallback } from 'react'
import { Send, Square, Paperclip } from 'lucide-react'
import { runAgent, cancelRun } from '@app/lib/agui/client'
import { useChatStore } from '@app/stores/chat'
import { useSettingsStore } from '@app/stores/settings'
import { generateId } from '@app/lib/utils'
import { useSessionsStore } from '@app/stores/sessions'
import { useNavigate } from '@tanstack/react-router'
import { cn } from '@app/lib/utils'

const slashCommands = [
  { cmd: '/new', desc: 'New session' },
  { cmd: '/clear', desc: 'Clear messages' },
  { cmd: '/model', desc: 'Switch model' },
  { cmd: '/skill', desc: 'Search skills' },
  { cmd: '/memory', desc: 'Search memory' },
  { cmd: '/cron', desc: 'Cron jobs' },
  { cmd: '/theme', desc: 'Switch theme' },
]

interface ComposerProps {
  sessionId?: string | null
}

export function Composer({ sessionId }: ComposerProps) {
  const [text, setText] = useState('')
  const [showSlash, setShowSlash] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const runStatus = useChatStore((s) => s.runStatus)
  const addSession = useSessionsStore((s) => s.addSession)
  const setActiveSessionId = useSessionsStore((s) => s.setActiveSessionId)
  const setTheme = useSettingsStore((s) => s.setTheme)
  const navigate = useNavigate()
  const isRunning = runStatus === 'running'

  const ensureSession = useCallback((): string => {
    if (sessionId) return sessionId
    const id = generateId()
    addSession({
      id,
      title: 'New chat',
      groupName: null,
      profileId: null,
      pinned: false,
      archived: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    setActiveSessionId(id)
    void navigate({ to: '/session/$id', params: { id } })
    return id
  }, [sessionId, addSession, setActiveSessionId, navigate])

  const handleSlash = (cmd: string) => {
    setShowSlash(false)
    setText('')
    if (cmd === '/new') {
      ensureSession()
    } else if (cmd === '/clear' && sessionId) {
      useChatStore.getState().setMessages(sessionId, [])
    } else if (cmd === '/theme') {
      const themes = ['dark', 'dim', 'light'] as const
      const current = useSettingsStore.getState().theme
      const next = themes[(themes.indexOf(current) + 1) % themes.length]!
      setTheme(next)
    }
  }

  const submit = async () => {
    const trimmed = text.trim()
    if (!trimmed || isRunning) return

    if (trimmed.startsWith('/')) {
      const cmd = slashCommands.find((c) => trimmed.startsWith(c.cmd))
      if (cmd) {
        handleSlash(cmd.cmd)
        return
      }
    }

    const sid = ensureSession()
    setText('')
    await runAgent({ sessionId: sid, content: trimmed })
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void submit()
    }
  }

  const filteredSlash = slashCommands.filter((c) =>
    text.startsWith('/') ? c.cmd.startsWith(text.split(' ')[0] ?? '') : false,
  )

  return (
    <div className="relative px-4 py-3">
      {showSlash && filteredSlash.length > 0 && (
        <div className="absolute bottom-full left-4 right-4 mb-1 rounded-lg border border-border bg-canvas-subtle py-1 shadow-lg">
          {filteredSlash.map((c) => (
            <button
              key={c.cmd}
              type="button"
              className="flex w-full items-center gap-3 px-3 py-1.5 text-left text-sm hover:bg-canvas-inset"
              onClick={() => handleSlash(c.cmd)}
            >
              <span className="font-mono text-accent">{c.cmd}</span>
              <span className="text-fg-muted">{c.desc}</span>
            </button>
          ))}
        </div>
      )}
      <div className="mx-auto flex max-w-3xl items-end gap-2 rounded-lg border border-border bg-canvas-subtle p-2">
        <button
          type="button"
          className="shrink-0 rounded p-2 text-fg-muted hover:bg-canvas-inset hover:text-fg"
          title="Attach file"
        >
          <Paperclip size={18} />
        </button>
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            setShowSlash(e.target.value.startsWith('/'))
          }}
          onKeyDown={onKeyDown}
          placeholder="Message Hermes… (/ for commands)"
          rows={1}
          disabled={isRunning}
          className="max-h-40 min-h-[24px] flex-1 resize-none bg-transparent text-sm text-fg outline-none placeholder:text-fg-muted"
        />
        {isRunning ? (
          <button
            type="button"
            onClick={cancelRun}
            className="shrink-0 rounded-md bg-danger/20 p-2 text-danger hover:bg-danger/30"
            title="Stop"
          >
            <Square size={18} fill="currentColor" />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!text.trim()}
            className={cn(
              'shrink-0 rounded-md p-2 transition-colors',
              text.trim()
                ? 'bg-accent text-white hover:bg-accent-emphasis'
                : 'text-fg-muted',
            )}
            title="Send"
          >
            <Send size={18} />
          </button>
        )}
      </div>
    </div>
  )
}
