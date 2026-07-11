import type { RunAgentInput } from '@ag-ui/core'
import type { AgentProvider } from '../provider'
import type { EventEmitter } from '../../agui/events'
import { config } from '../../config'
import { ProviderError } from '../../errors'

export const hermesPythonProvider: AgentProvider = {
  id: 'hermes-python',
  async run(input: RunAgentInput, emit: EventEmitter, signal: AbortSignal) {
    const url = config.HERMES_PYTHON_URL
    if (!url) {
      throw new ProviderError(
        'hermes-python bridge not configured. Set HERMES_PYTHON_URL in environment.',
      )
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify({
        session_id: input.threadId,
        run_id: input.runId,
        messages: input.messages,
      }),
      signal,
    })

    if (!res.ok || !res.body) {
      throw new ProviderError(`Hermes Python bridge failed: ${res.status}`)
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const parts = buffer.split('\n\n')
      buffer = parts.pop() ?? ''
      for (const part of parts) {
        const line = part.split('\n').find((l) => l.startsWith('data:'))
        if (!line) continue
        const data = line.slice(5).trim()
        if (!data || data === '[DONE]') continue
        try {
          const event = JSON.parse(data) as Parameters<EventEmitter>[0]
          await emit(event)
        } catch {
          // best-effort bridge mapping
        }
      }
    }
  },
}
