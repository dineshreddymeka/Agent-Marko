import { randomUUID } from 'node:crypto'
import { EventType, type RunAgentInput } from '@ag-ui/core'
import { HermesCustomEvents } from '@hermes/shared'
import { registerTool } from './registry'

registerTool({
  name: 'delegate_to_agent',
  description:
    'Delegate a subtask to another agent provider; nested events stream into the parent run. Choose provider from the capability manifest providers[] list (only available targets).',
  dangerous: true,
  parameters: {
    type: 'object',
    properties: {
      provider: {
        type: 'string',
        description:
          'Target provider id from the capability manifest (native | agui-remote | hermes-python). Unavailable providers are rejected.',
      },
      prompt: { type: 'string', description: 'Subtask prompt for the nested agent run' },
    },
    required: ['provider', 'prompt'],
  },
  async execute(args, ctx) {
    const {
      validateDelegationProvider,
      sanitizeProviderError,
    } = await import('../provider-capabilities')
    const {
      beginDelegation,
      finishDelegation,
      registerRun,
      finishRun,
    } = await import('../../agui/runs')

    const prompt = String(args.prompt ?? '').trim()
    if (!prompt) {
      return {
        error: 'prompt is required',
        code: 'VALIDATION_ERROR',
        provider: null,
        available: [],
      }
    }

    const validation = await validateDelegationProvider(args.provider, {
      sessionId: ctx.sessionId,
    })
    if (!validation.ok) {
      return validation.result
    }

    const { providerId, provider } = validation
    const subRunId = randomUUID()
    const events: unknown[] = []
    const parentEmit = ctx.emit

    beginDelegation({
      parentRunId: ctx.runId,
      nestedRunId: subRunId,
      provider: providerId,
      threadId: ctx.sessionId,
    })

    const input: RunAgentInput = {
      threadId: ctx.sessionId,
      runId: subRunId,
      messages: [{ id: randomUUID(), role: 'user', content: prompt }],
      tools: [],
      state: {},
      context: [],
    }

    registerRun(input, {
      parentRunId: ctx.runId,
      provider: providerId,
      kind: 'delegated',
    })

    const emit = async (event: Parameters<NonNullable<typeof parentEmit>>[0]) => {
      events.push(event)
      if (parentEmit) {
        const tagged =
          event && typeof event === 'object'
            ? { ...event, parentRunId: ctx.runId, nestedRunId: subRunId, provider: providerId }
            : event
        await parentEmit(tagged as Parameters<NonNullable<typeof parentEmit>>[0])
      }
    }

    const emitDelegation = async (
      phase: 'started' | 'finished' | 'error',
      error?: string,
    ) => {
      if (!parentEmit) return
      await parentEmit({
        type: EventType.CUSTOM,
        name: HermesCustomEvents.DELEGATION,
        value: {
          phase,
          parentRunId: ctx.runId,
          nestedRunId: subRunId,
          provider: providerId,
          ...(error ? { error } : {}),
        },
      })
    }

    try {
      await emitDelegation('started')
      await emit({ type: EventType.RUN_STARTED, threadId: input.threadId, runId: subRunId })
      await provider.run(input, emit, ctx.signal)
      await emit({ type: EventType.RUN_FINISHED, threadId: input.threadId, runId: subRunId })
      finishDelegation(subRunId, 'finished')
      await emitDelegation('finished')
      return { ok: true, subRunId, eventCount: events.length, provider: providerId }
    } catch (err) {
      const safe = sanitizeProviderError(err)
      try {
        await emit({
          type: EventType.RUN_ERROR,
          threadId: input.threadId,
          runId: subRunId,
          message: safe.message,
          code: safe.code,
        })
      } catch {
        /* best-effort nested error event */
      }
      finishDelegation(subRunId, 'error', safe.message)
      try {
        await emitDelegation('error', safe.message)
      } catch {
        /* best-effort */
      }
      return {
        ok: false,
        subRunId,
        eventCount: events.length,
        provider: providerId,
        error: safe.message,
        code: safe.code,
      }
    } finally {
      finishRun(subRunId)
    }
  },
})
