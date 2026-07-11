import { randomUUID } from 'node:crypto'
import { EventType, type RunAgentInput } from '@ag-ui/core'
import { HermesCustomEvents } from '@hermes/shared'
import type { EventEmitter } from '../agui/events'
import { requestApproval } from './approval'
import { buildAgentContext } from './context'
import { streamChatCompletion, type ChatMessage } from './llm'
import { getTool, isDangerous, toLlmTools } from './tools/registry'
import { messagesRepo } from '../db/repositories/messages'
import { sessionsRepo } from '../db/repositories/sessions'
import { queueEmbedding } from '../vector/indexer'
import { ToolError } from '../errors'
import { logger } from '../log'

import './tools/shell'
import './tools/files'
import './tools/web'
import './tools/memory'
import './tools/skills'
import './tools/cron'
import './tools/a2ui'
import './tools/delegate_to_agent'
import './tools/code'

const MAX_TOOL_ITERATIONS = 20

function toChatMessages(input: RunAgentInput, systemPrompt: string): ChatMessage[] {
  const msgs: ChatMessage[] = [{ role: 'system', content: systemPrompt }]
  for (const m of input.messages) {
    if (m.role === 'user') {
      msgs.push({ role: 'user', content: m.content })
    } else if (m.role === 'assistant') {
      msgs.push({
        role: 'assistant',
        content: m.content,
        tool_calls: m.toolCalls?.map((tc) => ({
          id: tc.id,
          type: 'function' as const,
          function: { name: tc.function.name, arguments: tc.function.arguments },
        })),
      })
    } else if (m.role === 'tool') {
      msgs.push({ role: 'tool', content: m.content, tool_call_id: m.toolCallId })
    } else if (m.role === 'system') {
      msgs.push({ role: 'system', content: m.content })
    }
  }
  return msgs
}

export async function runNativeAgent(
  input: RunAgentInput,
  emit: EventEmitter,
  signal: AbortSignal,
): Promise<void> {
  const log = logger.child({ threadId: input.threadId, runId: input.runId })
  const ctx = await buildAgentContext(input)
  const chatMessages = toChatMessages(input, ctx.systemPrompt)
  const tools = toLlmTools()
  let iterations = 0
  let totalUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 }

  while (iterations++ < MAX_TOOL_ITERATIONS) {
    if (signal.aborted) return

    const messageId = randomUUID()
    let content = ''
    let thinking = ''
    const toolCalls = new Map<number, { id: string; name: string; arguments: string }>()
    let finishReason: string | null = null

    await emit({ type: EventType.TEXT_MESSAGE_START, messageId, role: 'assistant' })

    for await (const delta of streamChatCompletion({
      model: ctx.profile.model,
      temperature: ctx.profile.temperature,
      messages: chatMessages,
      tools,
      signal,
    })) {
      if (delta.usage) {
        totalUsage = delta.usage
      }
      if (delta.content) {
        content += delta.content
        await emit({ type: EventType.TEXT_MESSAGE_CONTENT, messageId, delta: delta.content })
      }
      if (delta.reasoning) {
        thinking += delta.reasoning
      }
      if (delta.toolCalls) {
        for (const tc of delta.toolCalls) {
          const existing = toolCalls.get(tc.index) ?? {
            id: tc.id ?? randomUUID(),
            name: '',
            arguments: '',
          }
          if (tc.id) existing.id = tc.id
          if (tc.name) existing.name = tc.name
          if (tc.arguments) existing.arguments += tc.arguments
          toolCalls.set(tc.index, existing)
        }
      }
      if (delta.finishReason) finishReason = delta.finishReason
    }

    await emit({ type: EventType.TEXT_MESSAGE_END, messageId })

    void messagesRepo.create({
      sessionId: input.threadId,
      runId: input.runId,
      role: 'assistant',
      content,
      thinking: thinking || null,
      tokens: totalUsage.completionTokens,
    }).then((msg) => queueEmbedding('message', msg.id, content))

    void sessionsRepo.touch(input.threadId)

    const calls = [...toolCalls.values()]
    if (finishReason !== 'tool_calls' && calls.length === 0) {
      break
    }

    chatMessages.push({
      role: 'assistant',
      content: content || undefined,
      tool_calls: calls.map((c) => ({
        id: c.id,
        type: 'function',
        function: { name: c.name, arguments: c.arguments },
      })),
    })

    for (const call of calls) {
      if (signal.aborted) return
      let parsedArgs: Record<string, unknown> = {}
      try {
        parsedArgs = JSON.parse(call.arguments || '{}') as Record<string, unknown>
      } catch {
        parsedArgs = {}
      }

      await emit({
        type: EventType.TOOL_CALL_START,
        toolCallId: call.id,
        toolCallName: call.name,
        parentMessageId: messageId,
      })
      await emit({
        type: EventType.TOOL_CALL_ARGS,
        toolCallId: call.id,
        delta: call.arguments,
      })
      await emit({ type: EventType.TOOL_CALL_END, toolCallId: call.id })

      const tool = getTool(call.name)
      let result: unknown
      let error: string | undefined

      try {
        if (!tool) throw new ToolError(`Unknown tool: ${call.name}`)
        await requestApproval({
          sessionId: input.threadId,
          runId: input.runId,
          toolCallId: call.id,
          toolName: call.name,
          args: parsedArgs,
          emit,
          dangerous: isDangerous(call.name),
        })
        result = await tool.execute(parsedArgs, {
          sessionId: input.threadId,
          runId: input.runId,
          signal,
        })
        if (
          result &&
          typeof result === 'object' &&
          'customEvent' in (result as Record<string, unknown>)
        ) {
          await emit((result as { customEvent: Parameters<EventEmitter>[0] }).customEvent)
        }
      } catch (err) {
        error = String(err)
        result = { error }
        log.warn('Tool execution failed', { tool: call.name, error })
      }

      const resultStr = typeof result === 'string' ? result : JSON.stringify(result)
      await emit({
        type: EventType.TOOL_CALL_RESULT,
        toolCallId: call.id,
        messageId: randomUUID(),
        content: resultStr,
        role: 'tool',
      })

      void messagesRepo.create({
        sessionId: input.threadId,
        runId: input.runId,
        role: 'tool',
        content: resultStr,
        toolName: call.name,
        toolArgs: parsedArgs,
        toolResult: result,
      })

      chatMessages.push({
        role: 'tool',
        content: resultStr,
        tool_call_id: call.id,
      })
    }
  }

  await emit({
    type: EventType.CUSTOM,
    name: HermesCustomEvents.CONTEXT,
    value: {
      ...totalUsage,
      contextLimit: 128_000,
    },
  })
}
