import type { StreamDelta } from './llm'
import type { ChatMessage } from './llm'
import { resolveMockScript } from './mock-scenarios'

export type MockLlmScript = {
  reasoning?: string[]
  content?: string[]
  toolCalls?: Array<{ name: string; arguments: Record<string, unknown> }>
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number }
}

export const DEFAULT_MOCK_SCRIPT: MockLlmScript = {
  reasoning: ['Analyzing', ' the request…'],
  content: ['Hello from mock LLM.'],
  usage: { promptTokens: 12, completionTokens: 8, totalTokens: 20 },
}

export function isMockLlmEnabled(): boolean {
  return process.env.HERMES_MOCK_LLM === '1' || process.env.LLM_API_KEY === 'mock'
}

export async function* streamMockCompletion(
  script?: MockLlmScript,
  opts?: { messages?: ChatMessage[] },
): AsyncGenerator<StreamDelta> {
  const resolved = script ?? resolveMockScript(opts?.messages ?? [])
  for (const chunk of resolved.reasoning ?? []) {
    yield { reasoning: chunk }
    await Bun.sleep(5)
  }

  for (const chunk of resolved.content ?? []) {
    yield { content: chunk }
    await Bun.sleep(5)
  }

  if (resolved.toolCalls?.length) {
    for (let i = 0; i < resolved.toolCalls.length; i++) {
      const call = resolved.toolCalls[i]!
      const id = `mock-tool-${i}`
      const argsJson = JSON.stringify(call.arguments)
      yield {
        toolCalls: [{ index: i, id, name: call.name, arguments: argsJson.slice(0, 8) }],
        finishReason: null,
      }
      if (argsJson.length > 8) {
        yield {
          toolCalls: [{ index: i, arguments: argsJson.slice(8) }],
        }
      }
    }
    yield { finishReason: 'tool_calls' }
  } else {
    yield { finishReason: 'stop' }
  }

  const usage = resolved.usage ?? DEFAULT_MOCK_SCRIPT.usage!
  yield { usage }
}
