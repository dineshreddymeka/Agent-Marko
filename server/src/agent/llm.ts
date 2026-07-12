import { config } from '../config'
import { LlmError } from '../errors'
import { isDebugChannel, logger } from '../log'
import { isMockLlmEnabled, streamMockCompletion } from './mock-llm'
import { dumpLlmDebug } from './llm-debug'

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content?: string
  name?: string
  tool_call_id?: string
  tool_calls?: Array<{
    id: string
    type: 'function'
    function: { name: string; arguments: string }
  }>
}

export type LlmTool = {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

export type StreamDelta = {
  content?: string
  reasoning?: string
  toolCalls?: Array<{ index: number; id?: string; name?: string; arguments?: string }>
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number }
  finishReason?: string | null
}

export async function* streamChatCompletion(opts: {
  model: string
  temperature: number
  messages: ChatMessage[]
  tools?: LlmTool[]
  signal?: AbortSignal
}): AsyncGenerator<StreamDelta> {
  const started = performance.now()
  if (isMockLlmEnabled()) {
    if (isDebugChannel('llm')) {
      logger.debug('LLM mock stream', {
        model: opts.model,
        messages: opts.messages.length,
        tools: opts.tools?.length ?? 0,
      })
    }
    yield* streamMockCompletion(undefined, { messages: opts.messages, signal: opts.signal })
    return
  }

  const url = `${config.LLM_BASE_URL.replace(/\/$/, '')}/chat/completions`
  if (isDebugChannel('llm')) {
    logger.debug('LLM request start', {
      url,
      model: opts.model,
      temperature: opts.temperature,
      messages: opts.messages.length,
      tools: opts.tools?.length ?? 0,
    })
  }
  await dumpLlmDebug('request', {
    model: opts.model,
    temperature: opts.temperature,
    messageCount: opts.messages.length,
    toolCount: opts.tools?.length ?? 0,
    messages: opts.messages,
  })

  // Hard ceiling so a dead bridge cannot leave the UI stuck after thinking.
  const timeoutMs = 120_000
  const timeoutSignal = AbortSignal.timeout(timeoutMs)
  const signal =
    opts.signal && typeof AbortSignal.any === 'function'
      ? AbortSignal.any([opts.signal, timeoutSignal])
      : (opts.signal ?? timeoutSignal)

  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: config.LLM_API_KEY ? `Bearer ${config.LLM_API_KEY}` : '',
      },
      body: JSON.stringify({
        model: opts.model,
        temperature: opts.temperature,
        messages: opts.messages,
        tools: opts.tools,
        stream: true,
        stream_options: { include_usage: true },
      }),
      signal,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const timedOut = err instanceof Error && err.name === 'TimeoutError'
    logger.error('LLM request transport failed', {
      url,
      timedOut,
      durationMs: Math.round(performance.now() - started),
      error: msg,
    })
    throw new LlmError(
      timedOut
        ? `LLM request timed out after ${timeoutMs / 1000}s (${url})`
        : `LLM unreachable at ${url}: ${msg}`,
    )
  }

  if (!res.ok) {
    const text = await res.text()
    logger.error('LLM request failed', {
      status: res.status,
      durationMs: Math.round(performance.now() - started),
      bodyPreview: text.slice(0, 500),
    })
    throw new LlmError(`LLM request failed (${res.status}): ${text}`)
  }

  if (!res.body) {
    throw new LlmError('LLM response has no body')
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || !trimmed.startsWith('data:')) continue
      const data = trimmed.slice(5).trim()
      if (data === '[DONE]') return
      try {
        const json = JSON.parse(data) as {
          choices?: Array<{
            delta?: {
              content?: string
              reasoning_content?: string
              tool_calls?: Array<{
                index: number
                id?: string
                function?: { name?: string; arguments?: string }
              }>
            }
            finish_reason?: string | null
          }>
          usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
        }
        const choice = json.choices?.[0]
        if (!choice && json.usage) {
          yield {
            usage: {
              promptTokens: json.usage.prompt_tokens ?? 0,
              completionTokens: json.usage.completion_tokens ?? 0,
              totalTokens: json.usage.total_tokens ?? 0,
            },
          }
          continue
        }
        if (!choice) continue
        const delta = choice.delta
        yield {
          content: delta?.content,
          reasoning: delta?.reasoning_content,
          toolCalls: delta?.tool_calls?.map((tc) => ({
            index: tc.index,
            id: tc.id,
            name: tc.function?.name,
            arguments: tc.function?.arguments,
          })),
          finishReason: choice.finish_reason,
          usage: json.usage
            ? {
                promptTokens: json.usage.prompt_tokens ?? 0,
                completionTokens: json.usage.completion_tokens ?? 0,
                totalTokens: json.usage.total_tokens ?? 0,
              }
            : undefined,
        }
      } catch (err) {
        logger.debug('Skipping malformed SSE chunk', { error: err })
      }
    }
  }

  if (isDebugChannel('llm')) {
    logger.debug('LLM stream end', {
      model: opts.model,
      durationMs: Math.round(performance.now() - started),
    })
  }
}

export async function chatCompletion(opts: {
  model: string
  temperature: number
  messages: ChatMessage[]
  signal?: AbortSignal
}): Promise<string> {
  let content = ''
  for await (const delta of streamChatCompletion(opts)) {
    if (delta.content) content += delta.content
  }
  return content
}
