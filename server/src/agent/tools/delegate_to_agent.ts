import { randomUUID } from 'node:crypto'
import { EventType, type RunAgentInput } from '@ag-ui/core'
import { resolveProviderById } from '../provider'
import { registerTool } from './registry'
import type { EventEmitter } from '../../agui/events'

registerTool({
  name: 'delegate_to_agent',
  description: 'Delegate a subtask to another agent provider',
  parameters: {
    type: 'object',
    properties: {
      provider: { type: 'string', enum: ['native', 'agui-remote', 'hermes-python'] },
      prompt: { type: 'string' },
    },
    required: ['provider', 'prompt'],
  },
  async execute(args, ctx) {
    const provider = await resolveProviderById(
      args.provider as 'native' | 'agui-remote' | 'hermes-python',
    )
    const subRunId = randomUUID()
    const events: unknown[] = []
    const emit: EventEmitter = (event) => {
      events.push(event)
    }
    const input: RunAgentInput = {
      threadId: ctx.sessionId,
      runId: subRunId,
      messages: [{ id: randomUUID(), role: 'user', content: String(args.prompt) }],
      tools: [],
      state: {},
      context: [],
    }
    await emit({ type: EventType.RUN_STARTED, threadId: input.threadId, runId: subRunId })
    await provider.run(input, emit, ctx.signal)
    await emit({ type: EventType.RUN_FINISHED, threadId: input.threadId, runId: subRunId })
    return { subRunId, events }
  },
})
