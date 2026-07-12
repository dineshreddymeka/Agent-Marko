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

/**
 * Mock is opt-in only. Explicit HERMES_MOCK_LLM=0/false wins even if a shell
 * leftover set something else oddly; LLM_API_KEY=mock is the other opt-in.
 * When env is unset, prefer a configured LLM_BASE_URL (live) over mock.
 */
export function isMockLlmEnabled(): boolean {
  const flag = (process.env.HERMES_MOCK_LLM ?? '').trim().toLowerCase()
  if (['0', 'false', 'no', 'off'].includes(flag)) return false
  if (['1', 'true', 'yes', 'on'].includes(flag)) return true
  if ((process.env.LLM_API_KEY ?? '').trim() === 'mock') return true
  if ((process.env.LLM_BASE_URL ?? '').trim()) return false
  return false
}

export async function* streamMockCompletion(
  script?: MockLlmScript,
  opts?: { messages?: ChatMessage[]; signal?: AbortSignal },
): AsyncGenerator<StreamDelta> {
  const resolved = script ?? resolveMockScript(opts?.messages ?? [])
  for (const chunk of resolved.reasoning ?? []) {
    if (opts?.signal?.aborted) {
      const err = new Error('Aborted')
      err.name = 'AbortError'
      throw err
    }
    yield { reasoning: chunk }
    await Bun.sleep(5)
  }

  for (const chunk of resolved.content ?? []) {
    if (opts?.signal?.aborted) {
      const err = new Error('Aborted')
      err.name = 'AbortError'
      throw err
    }
    yield { content: chunk }
    await Bun.sleep(5)
  }

  if (resolved.toolCalls?.length) {
    for (let i = 0; i < resolved.toolCalls.length; i++) {
      if (opts?.signal?.aborted) {
        const err = new Error('Aborted')
        err.name = 'AbortError'
        throw err
      }
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
