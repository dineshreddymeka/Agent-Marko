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

  /**
   * Replays the @ag-ui/client verifier rules for thinking events:
   * THINKING_TEXT_MESSAGE_* must live inside a THINKING_START/THINKING_END
   * pair, and pairs must be balanced when the run ends.
   */
  function assertThinkingProtocol(events: BaseEvent[]): void {
    let stepActive = false
    let messageActive = false
    for (const e of events) {
      switch (e.type) {
        case EventType.THINKING_START:
          expect(stepActive).toBe(false)
          stepActive = true
          break
        case EventType.THINKING_END:
          expect(stepActive).toBe(true)
          expect(messageActive).toBe(false)
          stepActive = false
          break
        case EventType.THINKING_TEXT_MESSAGE_START:
          expect(stepActive).toBe(true)
          expect(messageActive).toBe(false)
          messageActive = true
          break
        case EventType.THINKING_TEXT_MESSAGE_CONTENT:
          expect(messageActive).toBe(true)
          break
        case EventType.THINKING_TEXT_MESSAGE_END:
          expect(messageActive).toBe(true)
          messageActive = false
          break
        default:
          break
      }
    }
    expect(stepActive).toBe(false)
    expect(messageActive).toBe(false)
  }

  test('THINKING_START precedes thinking text and pairs are balanced', async () => {
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
    const firstThinkingStart = types.indexOf(EventType.THINKING_START)
    const firstThinkingTextStart = types.indexOf(EventType.THINKING_TEXT_MESSAGE_START)
    expect(firstThinkingStart).toBeGreaterThanOrEqual(0)
    expect(firstThinkingTextStart).toBeGreaterThan(firstThinkingStart)
    expect(types.filter((t) => t === EventType.THINKING_START).length).toBe(
      types.filter((t) => t === EventType.THINKING_END).length,
    )
    assertThinkingProtocol(events)
  })

  test('multiple thinking bursts across tool-call turns stay balanced', async () => {
    const events: BaseEvent[] = []
    const emit = async (event: BaseEvent) => {
      events.push(event)
    }

    const input: RunAgentInput = {
      threadId: randomUUID(),
      runId: randomUUID(),
      // a2ui-cron scenario: turn 1 reasons + calls a tool, turn 2 reasons again.
      messages: [{ id: randomUUID(), role: 'user', content: 'Run a2ui-cron demo' }],
      tools: [],
      state: {},
      context: [],
    }

    await runNativeAgent(input, emit, new AbortController().signal)

    const types = events.map((e) => e.type)
    expect(types).toContain(EventType.TOOL_CALL_START)
    const thinkingStarts = types.filter((t) => t === EventType.THINKING_START).length
    expect(thinkingStarts).toBeGreaterThanOrEqual(2)
    expect(thinkingStarts).toBe(types.filter((t) => t === EventType.THINKING_END).length)
    assertThinkingProtocol(events)
  })
})
