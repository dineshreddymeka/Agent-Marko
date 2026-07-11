import type { RunAgentInput } from '@ag-ui/core'
import type { AgentProvider } from '../provider'
import type { EventEmitter } from '../../agui/events'
import { profilesRepo } from '../../db/repositories/profiles'
import { sessionsRepo } from '../../db/repositories/sessions'
import { ProviderError } from '../../errors'

export const aguiRemoteProvider: AgentProvider = {
  id: 'agui-remote',
  async run(input: RunAgentInput, emit: EventEmitter, signal: AbortSignal) {
    const session = await sessionsRepo.getById(input.threadId)
    let profile = session?.profileId ? await profilesRepo.getById(session.profileId) : null
    if (!profile) profile = await profilesRepo.getDefault()
    const cfg = (profile?.providerConfig ?? {}) as { endpoint?: string; authHeader?: string }
    const endpoint = cfg.endpoint
    if (!endpoint) {
      throw new ProviderError('agui-remote provider requires providerConfig.endpoint')
    }

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        ...(cfg.authHeader ? { Authorization: cfg.authHeader } : {}),
      },
      body: JSON.stringify(input),
      signal,
    })

    if (!res.ok || !res.body) {
      throw new ProviderError(`Remote AG-UI endpoint failed: ${res.status}`)
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
        if (data === '[DONE]') return
        try {
          const event = JSON.parse(data) as Parameters<EventEmitter>[0]
          await emit(event)
        } catch {
          // ignore malformed
        }
      }
    }
  },
}
