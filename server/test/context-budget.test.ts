import { describe, expect, test } from 'bun:test'

describe('context injection budget', () => {
  test('trimToBudget respects token estimate', async () => {
    process.env.HERMES_MOCK_LLM = '1'
    const { buildAgentContext } = await import('../src/agent/context')
    const { randomUUID } = await import('node:crypto')
    const ctx = await buildAgentContext({
      threadId: randomUUID(),
      runId: randomUUID(),
      messages: [{ id: randomUUID(), role: 'user', content: 'hi' }],
      tools: [],
      state: {},
      context: [],
    })
    expect(ctx.budget).toBeGreaterThan(0)
    expect(ctx.tokensUsed).toBeLessThanOrEqual(ctx.budget + 1000)
    expect(ctx.systemPrompt.length).toBeGreaterThan(0)
  })
})
