import { describe, expect, test, beforeAll, afterAll } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { EventType, type RunAgentInput } from '@ag-ui/core'
import type { BaseEvent } from '@ag-ui/core'
import { HermesCustomEvents } from '@hermes/shared'

process.env.HERMES_MOCK_LLM = '1'
process.env.AUTO_APPROVE_ALL = 'true'
delete process.env.HERMES_ROUTING

describe('runtime A2UI interceptors (capabilities mode)', () => {
  let runNativeAgent: typeof import('../src/agent/runtime').runNativeAgent

  beforeAll(async () => {
    ;({ runNativeAgent } = await import('../src/agent/runtime'))
  })

  afterAll(() => {
    delete process.env.HERMES_MOCK_LLM
  })

  async function runTurn(userText: string): Promise<BaseEvent[]> {
    const events: BaseEvent[] = []
    const emit = async (event: BaseEvent) => {
      events.push(event)
    }
    const input: RunAgentInput = {
      threadId: randomUUID(),
      runId: randomUUID(),
      messages: [{ id: randomUUID(), role: 'user', content: userText }],
      tools: [],
      state: {},
      context: [],
    }
    await runNativeAgent(input, emit, new AbortController().signal)
    return events
  }

  function findA2uiPayload(events: BaseEvent[]): Record<string, unknown> | null {
    const custom = events.find(
      (e) =>
        e.type === EventType.CUSTOM &&
        'name' in e &&
        (e as { name?: string }).name === HermesCustomEvents.A2UI_MESSAGE,
    ) as { value?: unknown } | undefined
    return custom?.value && typeof custom.value === 'object'
      ? (custom.value as Record<string, unknown>)
      : null
  }

  test('make me a form triggers form_request_show without LLM', async () => {
    const events = await runTurn('can you make me a form')
    const toolStart = events.find(
      (e) =>
        e.type === EventType.TOOL_CALL_START &&
        'toolCallName' in e &&
        (e as { toolCallName?: string }).toolCallName === 'form_request_show',
    )
    expect(toolStart).toBeDefined()
    const payload = findA2uiPayload(events)
    expect(payload?.component).toBeDefined()
    expect((payload?.component as { type?: string })?.type).toBe('hermes:FormRequestForm')
    expect(events.some((e) => e.type === EventType.TEXT_MESSAGE_CONTENT)).toBe(true)
  })

  test('create a pdf triggers document_form_show without LLM', async () => {
    const events = await runTurn('create a pdf about quarterly results')
    const toolStart = events.find(
      (e) =>
        e.type === EventType.TOOL_CALL_START &&
        'toolCallName' in e &&
        (e as { toolCallName?: string }).toolCallName === 'document_form_show',
    )
    expect(toolStart).toBeDefined()
    const payload = findA2uiPayload(events)
    expect((payload?.component as { type?: string })?.type).toBe('hermes:DocumentRequestForm')
    expect((payload?.component as { props?: { deliverableType?: string } })?.props?.deliverableType).toBe(
      'pdf',
    )
  })
})
