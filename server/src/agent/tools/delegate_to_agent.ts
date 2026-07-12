import { randomUUID } from 'node:crypto'
import { EventType, type RunAgentInput } from '@ag-ui/core'
import { registerTool } from './registry'

registerTool({
  name: 'delegate_to_agent',
  description: 'Delegate a subtask to another agent provider; nested events stream into the parent run',
  dangerous: true,
  parameters: {
    type: 'object',
    properties: {
      provider: { type: 'string', enum: ['native', 'agui-remote', 'hermes-python'] },
      prompt: { type: 'string' },
    },
    required: ['provider', 'prompt'],
  },
  async execute(args, ctx) {
    // Dynamic import breaks provider↔runtime↔delegate_to_agent cycle at module init.
    const { resolveProviderById } = await import('../provider')
    const provider = await resolveProviderById(
      args.provider as 'native' | 'agui-remote' | 'hermes-python',
    )
    const subRunId = randomUUID()
    const events: unknown[] = []
    const parentEmit = ctx.emit
    const emit = async (event: Parameters<NonNullable<typeof parentEmit>>[0]) => {
      events.push(event)
      if (parentEmit) {
        // Tag nested run so UI can correlate
        const tagged =
          event && typeof event === 'object'
            ? { ...event, parentRunId: ctx.runId, nestedRunId: subRunId }
            : event
        await parentEmit(tagged as Parameters<NonNullable<typeof parentEmit>>[0])
      }
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
    return { subRunId, eventCount: events.length, provider: args.provider }
  },
})
