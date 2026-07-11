import { describe, expect, test, beforeAll, afterAll } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { EventType, type RunAgentInput } from '@ag-ui/core'
import type { BaseEvent } from '@ag-ui/core'

process.env.HERMES_MOCK_LLM = '1'
process.env.AUTO_APPROVE_ALL = 'true'

describe('native agent (mock LLM)', () => {
  let runNativeAgent: typeof import('../src/agent/runtime').runNativeAgent

  beforeAll(async () => {
    ;({ runNativeAgent } = await import('../src/agent/runtime'))
  })

  afterAll(() => {
    delete process.env.HERMES_MOCK_LLM
  })

  test('emits text, thinking, and context usage events', async () => {
    const events: BaseEvent[] = []
    const emit = async (event: BaseEvent) => {
      events.push(event)
    }

    const input: RunAgentInput = {
      threadId: randomUUID(),
      runId: randomUUID(),
      messages: [{ id: randomUUID(), role: 'user', content: 'Hello' }],
      tools: [],
      state: {},
      context: [],
    }

    await runNativeAgent(input, emit, new AbortController().signal)

    const types = events.map((e) => e.type)
    expect(types).toContain(EventType.TEXT_MESSAGE_START)
    expect(types).toContain(EventType.TEXT_MESSAGE_CONTENT)
    expect(types).toContain(EventType.TEXT_MESSAGE_END)
    expect(types).toContain(EventType.THINKING_TEXT_MESSAGE_START)
    expect(types).toContain(EventType.THINKING_TEXT_MESSAGE_CONTENT)
    expect(types).toContain(EventType.THINKING_TEXT_MESSAGE_END)

    const contextEvent = events.find((e) => e.type === EventType.CUSTOM && 'name' in e)
    expect(contextEvent).toBeDefined()
  })
})
