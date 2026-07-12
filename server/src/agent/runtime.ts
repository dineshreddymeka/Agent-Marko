import { randomUUID } from 'node:crypto'
import { EventType, type RunAgentInput } from '@ag-ui/core'
import { HermesCustomEvents } from '@hermes/shared'
import type { EventEmitter } from '../agui/events'
import { cancelPendingApprovalsForRun, requestApproval } from './approval'
import { buildAgentContext } from './context'
import { streamChatCompletion, type ChatMessage } from './llm'
import { getTool, isDangerous } from './tools/registry'
import { planTurnCapabilities } from '../capabilities'
import {
  shouldAutoShowCronForm,
  looksLikeCronIntent,
  shouldAutoShowDocumentForm,
  buildDocumentFormFromUserText,
  shouldAutoShowFormRequest,
} from './tools/a2ui'
import {
  buildDocumentDraftMarkdown,
  documentDraftPath,
  extractDocumentTopic,
  looksLikeDocumentIntent,
  prefersCoworkDocument,
  shouldAutoCreateDocumentDraft,
} from './document-intent'
import { looksLikeFormIntent } from './form-intent'
import { splitLeakedPlanning } from './response-sanitize'
import { messagesRepo } from '../db/repositories/messages'
import { sessionsRepo } from '../db/repositories/sessions'
import { queueEmbedding } from '../vector/indexer'
import { isHermesError, ToolError } from '../errors'
import { isDebugChannel, logger } from '../log'
import { config } from '../config'

import './tools/shell'
import './tools/files'
import './tools/web'
import './tools/memory'
import './tools/skills'
import './tools/cron'
import './tools/a2ui'
import './tools/delegate_to_agent'
import './tools/delegate_to_cowork'
import './tools/code'
import './tools/index_search'
import './tools/chrome'

const MAX_TOOL_ITERATIONS = 20
const THINKING_FLUSH_MS = 100

/** Consecutive calls in this set run via Promise.all (no mutating side effects). */
const READ_ONLY_TOOL_NAMES = new Set([
  'web_search',
  'fetch_url',
  'read_file',
  'list_dir',
  'memory_search',
  'index_search',
  'skill_search',
])

function isParallelReadOnlyTool(name: string): boolean {
  return READ_ONLY_TOOL_NAMES.has(name) && !isDangerous(name)
}

async function emitContextUsage(
  emit: EventEmitter,
  runUsage: { promptTokens: number; completionTokens: number; totalTokens: number },
): Promise<void> {
  await emit({
    type: EventType.CUSTOM,
    name: HermesCustomEvents.CONTEXT,
    value: {
      ...runUsage,
      tokensUsed: runUsage.totalTokens,
      tokensMax: config.CONTEXT_TOKEN_LIMIT,
      contextLimit: config.CONTEXT_TOKEN_LIMIT,
      injectionBudget: config.CONTEXT_INJECTION_BUDGET,
    },
  })
}

function formatToolError(err: unknown): { error: string; code?: string; details?: unknown } {
  if (isHermesError(err)) {
    return { error: err.message, code: err.code, details: err.details }
  }
  if (err instanceof Error) {
    return { error: err.message, code: 'TOOL_ERROR' }
  }
  return { error: String(err), code: 'TOOL_ERROR' }
}

async function flushThinkingBuffer(opts: {
  emit: EventEmitter
  /** Same id as the assistant TEXT_MESSAGE so UI shows one bubble, not a second empty Thinking. */
  messageId: string
  thinkingStarted: boolean
  buffer: string
}): Promise<{ thinkingStarted: boolean; buffer: string }> {
  // Ignore whitespace-only reasoning so we never open an empty THINKING_START/END pair.
  if (!opts.buffer.trim()) {
    return { thinkingStarted: opts.thinkingStarted, buffer: '' }
  }
  if (!opts.thinkingStarted) {
    // AG-UI protocol: a thinking step must be opened before thinking text messages.
    await opts.emit({ type: EventType.THINKING_START })
    await opts.emit({
      type: EventType.THINKING_TEXT_MESSAGE_START,
      messageId: opts.messageId,
      role: 'assistant',
    })
    opts.thinkingStarted = true
  }
  await opts.emit({
    type: EventType.THINKING_TEXT_MESSAGE_CONTENT,
    messageId: opts.messageId,
    delta: opts.buffer,
  })
  return { thinkingStarted: opts.thinkingStarted, buffer: '' }
}

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
  const onAbort = () => {
    cancelPendingApprovalsForRun(input.runId)
  }
  signal.addEventListener('abort', onAbort, { once: true })

  try {
    // Persist the latest user turn before streaming so refresh/reload can hydrate.
    // AG-UI threadId is the Postgres session id; ensure the row exists (FK).
    const lastUser = [...input.messages].reverse().find((m) => m.role === 'user')
    const lastUserText =
      lastUser && 'content' in lastUser ? String(lastUser.content ?? '') : ''
    try {
      await sessionsRepo.ensure(input.threadId)
      if (lastUserText) {
        const msg = await messagesRepo.create({
          sessionId: input.threadId,
          runId: input.runId,
          role: 'user',
          content: lastUserText,
        })
        queueEmbedding('message', msg.id, lastUserText)
      }
    } catch (err) {
      log.warn('Failed to persist user message', { error: String(err) })
    }

    const plan = await planTurnCapabilities({ messages: input.messages })
    if (plan.route.degraded) {
      await emit({
        type: EventType.CUSTOM,
        name: HermesCustomEvents.CAPABILITIES_DEGRADED,
        value: {
          reason: plan.route.reason,
          toolsEnabled: plan.route.toolsEnabled,
          bridgeFallback: plan.route.reason === 'bridge_fallback',
          circuitState: plan.route.circuitState,
          lastFailure: plan.route.lastFailure,
        },
      })
    }

    let iterations = 0
    let runUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 }

    // Deterministic A2UI interceptors run BEFORE context build so a slow/hung
    // embedding bridge cannot block cron/document/form surfaces.

    // Deterministic cron form for small models that narrate instead of calling tools.
    if (plan.allowPreLlmInterceptors && shouldAutoShowCronForm(lastUserText)) {
      const tool = getTool('cron_form_show')
      if (tool) {
        const messageId = randomUUID()
        const toolCallId = randomUUID()
        const ack = 'Opening the cron form — fill it in to create the job.'
        await emit({ type: EventType.TEXT_MESSAGE_START, messageId, role: 'assistant' })
        await emit({ type: EventType.TEXT_MESSAGE_CONTENT, messageId, delta: ack })
        await emit({ type: EventType.TEXT_MESSAGE_END, messageId })
        await emit({
          type: EventType.TOOL_CALL_START,
          toolCallId,
          toolCallName: 'cron_form_show',
          parentMessageId: messageId,
        })
        await emit({ type: EventType.TOOL_CALL_ARGS, toolCallId, delta: '{}' })
        await emit({ type: EventType.TOOL_CALL_END, toolCallId })
        const result = await tool.execute(
          {},
          { sessionId: input.threadId, runId: input.runId, signal, emit },
        )
        if (
          result &&
          typeof result === 'object' &&
          'customEvent' in (result as Record<string, unknown>)
        ) {
          await emit((result as { customEvent: Parameters<EventEmitter>[0] }).customEvent)
        }
        const resultStr = typeof result === 'string' ? result : JSON.stringify(result)
        await emit({
          type: EventType.TOOL_CALL_RESULT,
          toolCallId,
          messageId: randomUUID(),
          content: resultStr,
          role: 'tool',
        })
        try {
          const msg = await messagesRepo.create({
            sessionId: input.threadId,
            runId: input.runId,
            role: 'assistant',
            content: ack,
            thinking: null,
            tokens: 0,
          })
          queueEmbedding('message', msg.id, ack)
        } catch (err) {
          log.warn('Failed to persist assistant message', { error: String(err) })
        }
        await emitContextUsage(emit, runUsage)
        return
      }
    }

    // Deterministic document/PPT form for vague asks (mirrors cron_form_show).
    // Prevents plain-text Topic/Audience/Length questionnaires and "me" stub drafts.
    if (plan.allowPreLlmInterceptors && shouldAutoShowDocumentForm(lastUserText)) {
      const tool = getTool('document_form_show')
      if (tool) {
        const prefill = buildDocumentFormFromUserText(lastUserText)
        const args = {
          deliverableType: prefill.component.props.deliverableType || undefined,
          topic: prefill.component.props.topic || undefined,
          notes: prefill.component.props.notes || undefined,
        }
        const argsJson = JSON.stringify(args)
        const messageId = randomUUID()
        const toolCallId = randomUUID()
        const ack =
          'Opening the document request form — pick the deliverable type and fill in topic, audience, and length.'
        await emit({ type: EventType.TEXT_MESSAGE_START, messageId, role: 'assistant' })
        await emit({ type: EventType.TEXT_MESSAGE_CONTENT, messageId, delta: ack })
        await emit({ type: EventType.TEXT_MESSAGE_END, messageId })
        await emit({
          type: EventType.TOOL_CALL_START,
          toolCallId,
          toolCallName: 'document_form_show',
          parentMessageId: messageId,
        })
        await emit({ type: EventType.TOOL_CALL_ARGS, toolCallId, delta: argsJson })
        await emit({ type: EventType.TOOL_CALL_END, toolCallId })
        const result = await tool.execute(args, {
          sessionId: input.threadId,
          runId: input.runId,
          signal,
          emit,
        })
        if (
          result &&
          typeof result === 'object' &&
          'customEvent' in (result as Record<string, unknown>)
        ) {
          await emit((result as { customEvent: Parameters<EventEmitter>[0] }).customEvent)
        }
        const resultStr = typeof result === 'string' ? result : JSON.stringify(result)
        await emit({
          type: EventType.TOOL_CALL_RESULT,
          toolCallId,
          messageId: randomUUID(),
          content: resultStr,
          role: 'tool',
        })
        try {
          const msg = await messagesRepo.create({
            sessionId: input.threadId,
            runId: input.runId,
            role: 'assistant',
            content: ack,
            thinking: null,
            tokens: 0,
          })
          queueEmbedding('message', msg.id, ack)
        } catch (err) {
          log.warn('Failed to persist assistant message', { error: String(err) })
        }
        await emitContextUsage(emit, runUsage)
        return
      }
    }

    // Deterministic generic form-request surface (mirrors cron/document forms).
    // Prevents greeting resets and plain-text "what can I help with?" on form asks.
    if (plan.allowPreLlmInterceptors && shouldAutoShowFormRequest(lastUserText)) {
      const tool = getTool('form_request_show')
      if (tool) {
        const messageId = randomUUID()
        const toolCallId = randomUUID()
        const ack =
          'Opening the form builder — tell me the purpose, fields, submit action, and where to store results.'
        await emit({ type: EventType.TEXT_MESSAGE_START, messageId, role: 'assistant' })
        await emit({ type: EventType.TEXT_MESSAGE_CONTENT, messageId, delta: ack })
        await emit({ type: EventType.TEXT_MESSAGE_END, messageId })
        await emit({
          type: EventType.TOOL_CALL_START,
          toolCallId,
          toolCallName: 'form_request_show',
          parentMessageId: messageId,
        })
        await emit({ type: EventType.TOOL_CALL_ARGS, toolCallId, delta: '{}' })
        await emit({ type: EventType.TOOL_CALL_END, toolCallId })
        const result = await tool.execute(
          {},
          { sessionId: input.threadId, runId: input.runId, signal, emit },
        )
        if (
          result &&
          typeof result === 'object' &&
          'customEvent' in (result as Record<string, unknown>)
        ) {
          await emit((result as { customEvent: Parameters<EventEmitter>[0] }).customEvent)
        }
        const resultStr = typeof result === 'string' ? result : JSON.stringify(result)
        await emit({
          type: EventType.TOOL_CALL_RESULT,
          toolCallId,
          messageId: randomUUID(),
          content: resultStr,
          role: 'tool',
        })
        try {
          const msg = await messagesRepo.create({
            sessionId: input.threadId,
            runId: input.runId,
            role: 'assistant',
            content: ack,
            thinking: null,
            tokens: 0,
          })
          queueEmbedding('message', msg.id, ack)
        } catch (err) {
          log.warn('Failed to persist assistant message', { error: String(err) })
        }
        await emitContextUsage(emit, runUsage)
        return
      }
    }

    // Deterministic workspace draft for clear create/draft/work-file asks.
    // Small models otherwise reply "What would you like help with?" without tools.
    if (plan.allowPreLlmInterceptors && shouldAutoCreateDocumentDraft(lastUserText)) {
      const tool = getTool('write_file')
      if (tool) {
        const topic = extractDocumentTopic(lastUserText) ?? 'draft'
        const path = documentDraftPath(topic)
        const content = buildDocumentDraftMarkdown(topic, lastUserText)
        const args = { path, content }
        const argsJson = JSON.stringify(args)
        const messageId = randomUUID()
        const toolCallId = randomUUID()
        const ack =
          `Created a working draft about **${topic}** at \`${path}\`.\n\n` +
          `## Preview\n\n${content.slice(0, 1200)}`
        await emit({ type: EventType.TEXT_MESSAGE_START, messageId, role: 'assistant' })
        await emit({ type: EventType.TEXT_MESSAGE_CONTENT, messageId, delta: ack })
        await emit({ type: EventType.TEXT_MESSAGE_END, messageId })
        await emit({
          type: EventType.TOOL_CALL_START,
          toolCallId,
          toolCallName: 'write_file',
          parentMessageId: messageId,
        })
        await emit({ type: EventType.TOOL_CALL_ARGS, toolCallId, delta: argsJson })
        await emit({ type: EventType.TOOL_CALL_END, toolCallId })
        const result = await tool.execute(args, {
          sessionId: input.threadId,
          runId: input.runId,
          signal,
          emit,
        })
        const resultStr = typeof result === 'string' ? result : JSON.stringify(result)
        await emit({
          type: EventType.TOOL_CALL_RESULT,
          toolCallId,
          messageId: randomUUID(),
          content: resultStr,
          role: 'tool',
        })
        try {
          const msg = await messagesRepo.create({
            sessionId: input.threadId,
            runId: input.runId,
            role: 'assistant',
            content: ack,
            thinking: null,
            tokens: 0,
          })
          queueEmbedding('message', msg.id, ack)
        } catch (err) {
          log.warn('Failed to persist assistant message', { error: String(err) })
        }
        await emitContextUsage(emit, runUsage)
        return
      }
    }

    const ctx = await buildAgentContext(input)
    const chatMessages = toChatMessages(input, ctx.systemPrompt)
    // Capability hub retrieval (semantic/lexical) or HERMES_ROUTING=legacy subset.
    const tools = plan.tools.tools

    while (iterations++ < MAX_TOOL_ITERATIONS) {
      if (signal.aborted) return

      const messageId = randomUUID()
      let content = ''
      let thinking = ''
      let thinkingStarted = false
      let thinkingPending = ''
      let lastThinkingFlush = 0
      const toolCalls = new Map<number, { id: string; name: string; arguments: string }>()
      let finishReason: string | null = null
      let iterationUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 }

      await emit({ type: EventType.TEXT_MESSAGE_START, messageId, role: 'assistant' })

      try {
        for await (const delta of streamChatCompletion({
          model: ctx.profile.model,
          temperature: ctx.profile.temperature,
          messages: chatMessages,
          tools: tools.length > 0 ? tools : undefined,
          baseUrl: plan.route.baseUrl,
          signal,
        })) {
          if (signal.aborted) return
          if (delta.usage) {
            iterationUsage = delta.usage
          }
          if (delta.content) {
            content += delta.content
            await emit({ type: EventType.TEXT_MESSAGE_CONTENT, messageId, delta: delta.content })
          }
          if (delta.reasoning) {
            // Drop whitespace-only reasoning chunks (nano models sometimes emit empty segments).
            if (!delta.reasoning.trim() && !thinkingPending.trim()) continue
            thinking += delta.reasoning
            thinkingPending += delta.reasoning
            const now = Date.now()
            if (now - lastThinkingFlush >= THINKING_FLUSH_MS) {
              const flushed = await flushThinkingBuffer({
                emit,
                messageId,
                thinkingStarted,
                buffer: thinkingPending,
              })
              thinkingStarted = flushed.thinkingStarted
              thinkingPending = flushed.buffer
              lastThinkingFlush = now
            }
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
      } catch (err) {
        // Always close open thinking/text frames so the UI never stalls on
        // "Analyzing…" after a bridge/LLM failure mid-stream.
        try {
          if (thinkingPending.trim()) {
            const flushed = await flushThinkingBuffer({
              emit,
              messageId,
              thinkingStarted,
              buffer: thinkingPending,
            })
            thinkingStarted = flushed.thinkingStarted
            thinkingPending = flushed.buffer
          }
          if (thinkingStarted) {
            await emit({ type: EventType.THINKING_TEXT_MESSAGE_END, messageId })
            await emit({ type: EventType.THINKING_END })
          }
          if (!content) {
            const failNote =
              err instanceof Error ? `LLM error: ${err.message}` : 'LLM error: request failed'
            content = failNote
            await emit({ type: EventType.TEXT_MESSAGE_CONTENT, messageId, delta: failNote })
          }
          await emit({ type: EventType.TEXT_MESSAGE_END, messageId })
        } catch {
          /* best-effort close */
        }
        if (signal.aborted || (err instanceof Error && err.name === 'AbortError')) {
          return
        }
        throw err
      }

      if (signal.aborted) return

      if (thinkingPending.trim()) {
        const flushed = await flushThinkingBuffer({
          emit,
          messageId,
          thinkingStarted,
          buffer: thinkingPending,
        })
        thinkingStarted = flushed.thinkingStarted
        thinkingPending = flushed.buffer
      } else {
        thinkingPending = ''
      }
      if (thinkingStarted) {
        await emit({ type: EventType.THINKING_TEXT_MESSAGE_END, messageId })
        await emit({ type: EventType.THINKING_END })
      }

      await emit({ type: EventType.TEXT_MESSAGE_END, messageId })

      // Composer bridges sometimes put planning narration in `content` instead of
      // `reasoning_content`. Peel it into thinking for persistence / next-turn history.
      const split = splitLeakedPlanning(content)
      if (split.thinkingExtra) {
        thinking = [thinking, split.thinkingExtra].filter(Boolean).join('\n').trim()
        content = split.content
      }

      // Auto-title first exchange from user message
      if (iterations === 1) {
        const userMsg = [...input.messages].reverse().find((m) => m.role === 'user')
        const raw =
          userMsg && 'content' in userMsg ? String(userMsg.content ?? '') : content.trim()
        const title = raw.replace(/\s+/g, ' ').slice(0, 72)
        if (title) {
          void sessionsRepo
            .getById(input.threadId)
            .then(async (session) => {
              if (!session) return
              if (session.title && session.title !== 'New chat') return
              await sessionsRepo.update(input.threadId, { title })
              await emit({
                type: EventType.CUSTOM,
                name: HermesCustomEvents.TITLE,
                value: { sessionId: input.threadId, title },
              })
            })
            .catch(() => undefined)
        }
      }

      runUsage = {
        promptTokens: runUsage.promptTokens + iterationUsage.promptTokens,
        completionTokens: runUsage.completionTokens + iterationUsage.completionTokens,
        totalTokens: runUsage.totalTokens + iterationUsage.totalTokens,
      }

      try {
        const msg = await messagesRepo.create({
          sessionId: input.threadId,
          runId: input.runId,
          role: 'assistant',
          content,
          thinking: thinking.trim() || null,
          tokens: iterationUsage.completionTokens,
        })
        queueEmbedding('message', msg.id, content)
      } catch (err) {
        log.warn('Failed to persist assistant message', { error: String(err) })
      }

      void sessionsRepo.touch(input.threadId).catch(() => undefined)

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

      type ToolCallItem = (typeof calls)[number]
      type ToolExecOutcome = {
        call: ToolCallItem
        parsedArgs: Record<string, unknown>
        result: unknown
        errorPayload: ReturnType<typeof formatToolError> | undefined
        aborted: boolean
      }

      const parseToolArgs = (raw: string): Record<string, unknown> => {
        try {
          return JSON.parse(raw || '{}') as Record<string, unknown>
        } catch {
          return { _raw: raw, _parseError: true }
        }
      }

      const emitToolCallLifecycle = async (call: ToolCallItem) => {
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
      }

      const executeOneTool = async (
        call: ToolCallItem,
        parsedArgs: Record<string, unknown>,
      ): Promise<ToolExecOutcome> => {
        const tool = getTool(call.name)
        let result: unknown
        let errorPayload: ReturnType<typeof formatToolError> | undefined
        let aborted = false

        try {
          if (!tool) throw new ToolError(`Unknown tool: ${call.name}`)
          if (parsedArgs._parseError) {
            throw new ToolError('Invalid tool arguments JSON', { raw: call.arguments })
          }
          await requestApproval({
            sessionId: input.threadId,
            runId: input.runId,
            toolCallId: call.id,
            toolName: call.name,
            args: parsedArgs,
            emit,
            dangerous: isDangerous(call.name),
          })
          if (signal.aborted) {
            return {
              call,
              parsedArgs,
              result: { error: 'Aborted' },
              errorPayload: undefined,
              aborted: true,
            }
          }
          if (isDebugChannel('tools')) {
            log.debug('Tool invoke start', {
              toolName: call.name,
              toolCallId: call.id,
              argsPreview: JSON.stringify(parsedArgs).slice(0, 400),
            })
          }
          const toolStarted = performance.now()
          result = await tool.execute(parsedArgs, {
            sessionId: input.threadId,
            runId: input.runId,
            signal,
            emit,
          })
          if (isDebugChannel('tools')) {
            log.debug('Tool invoke end', {
              toolName: call.name,
              toolCallId: call.id,
              durationMs: Math.round(performance.now() - toolStarted),
            })
          }
          if (
            result &&
            typeof result === 'object' &&
            'customEvent' in (result as Record<string, unknown>)
          ) {
            await emit((result as { customEvent: Parameters<EventEmitter>[0] }).customEvent)
          }
        } catch (err) {
          if (signal.aborted || (err instanceof Error && err.name === 'AbortError')) {
            errorPayload = formatToolError(err)
            result = errorPayload ?? { error: 'Aborted' }
            aborted = true
          } else {
            errorPayload = formatToolError(err)
            result = errorPayload
            log.child({ toolName: call.name, toolCallId: call.id }).warn('Tool execution failed', {
              error: err,
              code: errorPayload.code,
            })
          }
        }

        return { call, parsedArgs, result, errorPayload, aborted }
      }

      const finalizeToolOutcome = async (outcome: ToolExecOutcome): Promise<boolean> => {
        const { call, parsedArgs, result, errorPayload, aborted } = outcome
        const resultStr = typeof result === 'string' ? result : JSON.stringify(result)
        try {
          await emit({
            type: EventType.TOOL_CALL_RESULT,
            toolCallId: call.id,
            messageId: randomUUID(),
            content: resultStr,
            role: 'tool',
          })
        } catch {
          /* best-effort on abort */
        }

        if (aborted) return true

        if (errorPayload) {
          await emit({
            type: EventType.CUSTOM,
            name: HermesCustomEvents.TOOL_ERROR,
            value: {
              toolCallId: call.id,
              toolName: call.name,
              ...errorPayload,
            },
          })
        }

        try {
          const msg = await messagesRepo.create({
            sessionId: input.threadId,
            runId: input.runId,
            role: 'tool',
            content: resultStr,
            toolName: call.name,
            toolArgs: parsedArgs,
            toolResult: result as Record<string, unknown>,
          })
          queueEmbedding('message', msg.id, resultStr)
        } catch (err) {
          log.warn('Failed to persist tool message', { error: String(err) })
        }

        chatMessages.push({
          role: 'tool',
          content: resultStr,
          tool_call_id: call.id,
        })
        return false
      }

      let callIdx = 0
      while (callIdx < calls.length) {
        if (signal.aborted) return
        const head = calls[callIdx]!
        if (isParallelReadOnlyTool(head.name)) {
          const batch: ToolCallItem[] = []
          while (callIdx < calls.length && isParallelReadOnlyTool(calls[callIdx]!.name)) {
            batch.push(calls[callIdx]!)
            callIdx++
          }
          const prepared = batch.map((call) => ({
            call,
            parsedArgs: parseToolArgs(call.arguments),
          }))
          for (const { call } of prepared) {
            await emitToolCallLifecycle(call)
          }
          const outcomes = await Promise.all(
            prepared.map(({ call, parsedArgs }) => executeOneTool(call, parsedArgs)),
          )
          for (const outcome of outcomes) {
            const stop = await finalizeToolOutcome(outcome)
            if (stop) return
          }
        } else {
          const call = calls[callIdx]!
          callIdx++
          const parsedArgs = parseToolArgs(call.arguments)
          await emitToolCallLifecycle(call)
          const outcome = await executeOneTool(call, parsedArgs)
          const stop = await finalizeToolOutcome(outcome)
          if (stop) return
        }
      }
    }

    if (signal.aborted) return

    await emit({
      type: EventType.CUSTOM,
      name: HermesCustomEvents.CONTEXT,
      value: {
        ...runUsage,
        tokensUsed: runUsage.totalTokens,
        tokensMax: config.CONTEXT_TOKEN_LIMIT,
        contextLimit: config.CONTEXT_TOKEN_LIMIT,
        injectionBudget: config.CONTEXT_INJECTION_BUDGET,
      },
    })
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
}
