/**
 * Map Open Cowork JSONL events → hermes.cowork.progress payloads for AG-UI chat.
 * Knowledge: jarvis-integration §3.6 / §3.9 — stream tool + text events into Jarvis.
 */
import type { HermesCoworkProgressPayload } from '@hermes/shared'
import type { CoworkEvent } from './types'

export type CoworkProgressPhase = HermesCoworkProgressPayload['phase']

/** Throttle coalescer for high-frequency agent.text_delta. */
export function createDeltaThrottler(
  flush: (text: string) => void,
  intervalMs = 150,
): {
  push: (text: string) => void
  flushNow: () => void
} {
  let buf = ''
  let timer: ReturnType<typeof setTimeout> | null = null

  const flushNow = () => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    if (!buf) return
    const text = buf
    buf = ''
    flush(text)
  }

  return {
    push(text: string) {
      buf += text
      if (timer) return
      timer = setTimeout(flushNow, intervalMs)
    },
    flushNow,
  }
}

/**
 * Map a single Cowork stdout event to a progress payload (or null if ignore).
 * Caller supplies taskId / coworkSessionId.
 */
export function mapCoworkEventToProgress(
  evt: CoworkEvent,
  base: { taskId: string; coworkSessionId?: string | null },
): HermesCoworkProgressPayload | null {
  const taskId = base.taskId
  const coworkSessionId =
    (typeof evt.sessionId === 'string' ? evt.sessionId : null) ??
    base.coworkSessionId ??
    undefined

  switch (evt.type) {
    case 'session.started':
      return {
        taskId,
        coworkSessionId: typeof evt.sessionId === 'string' ? evt.sessionId : coworkSessionId,
        phase: 'started',
      }
    case 'agent.text_delta': {
      const text = String(evt.text ?? '')
      if (!text) return null
      return { taskId, coworkSessionId, phase: 'delta', text }
    }
    case 'agent.tool_start':
      return {
        taskId,
        coworkSessionId,
        phase: 'tool',
        tool: String(evt.tool ?? 'tool'),
        toolInput: evt.input,
      }
    case 'agent.tool_end':
      return {
        taskId,
        coworkSessionId,
        phase: 'tool',
        tool: String(evt.tool ?? 'tool'),
        toolOutput:
          typeof evt.output === 'string'
            ? evt.output.slice(0, 500)
            : evt.output != null
              ? JSON.stringify(evt.output).slice(0, 500)
              : undefined,
      }
    case 'session.end':
      return {
        taskId,
        coworkSessionId,
        phase: 'ended',
        text: typeof evt.result === 'string' ? evt.result.slice(0, 500) : undefined,
        ok: true,
      }
    case 'error':
      if (evt.sessionId && base.coworkSessionId && evt.sessionId !== base.coworkSessionId) {
        return null
      }
      return {
        taskId,
        coworkSessionId,
        phase: 'error',
        text: String(evt.message ?? 'cowork error'),
        ok: false,
      }
    default:
      return null
  }
}

/** Short line for ToolCallCard progress display. */
export function formatCoworkProgressLine(p: HermesCoworkProgressPayload): string {
  switch (p.phase) {
    case 'started':
      return `Open Cowork started (${p.taskId})`
    case 'delta':
      return (p.text ?? '').trim()
    case 'tool':
      return p.toolOutput
        ? `${p.tool ?? 'tool'}: ${p.toolOutput.slice(0, 120)}`
        : `Running ${p.tool ?? 'tool'}…`
    case 'ended':
      return p.text?.trim() || `Open Cowork finished (${p.taskId})`
    case 'error':
      return p.text?.trim() || 'Open Cowork error'
    default:
      return ''
  }
}
