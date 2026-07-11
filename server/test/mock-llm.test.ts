import { describe, expect, test } from 'bun:test'
import { isMockLlmEnabled, streamMockCompletion } from '../src/agent/mock-llm'

describe('mock LLM', () => {
  test('isMockLlmEnabled when HERMES_MOCK_LLM=1', () => {
    const prev = process.env.HERMES_MOCK_LLM
    process.env.HERMES_MOCK_LLM = '1'
    expect(isMockLlmEnabled()).toBe(true)
    process.env.HERMES_MOCK_LLM = prev
  })

  test('streams reasoning, content, and usage', async () => {
    const deltas = []
    for await (const delta of streamMockCompletion()) {
      deltas.push(delta)
    }
    expect(deltas.some((d) => d.reasoning)).toBe(true)
    expect(deltas.some((d) => d.content)).toBe(true)
    expect(deltas.at(-1)?.usage?.totalTokens).toBeGreaterThan(0)
  })

  test('streams tool calls when scripted', async () => {
    const deltas = []
    for await (const delta of streamMockCompletion({
      content: [],
      toolCalls: [{ name: 'list_dir', arguments: { path: '.' } }],
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    })) {
      deltas.push(delta)
    }
    expect(deltas.some((d) => d.toolCalls?.length)).toBe(true)
    expect(deltas.some((d) => d.finishReason === 'tool_calls')).toBe(true)
  })
})
