import {
  EventType,
  type BaseEvent,
  type CustomEvent,
  type MessagesSnapshotEvent,
  type RunErrorEvent,
  type RunStartedEvent,
  type StateDeltaEvent,
  type StateSnapshotEvent,
  type StepFinishedEvent,
  type StepStartedEvent,
  type TextMessageContentEvent,
  type TextMessageEndEvent,
  type TextMessageStartEvent,
  type ThinkingTextMessageContentEvent,
  type ThinkingTextMessageStartEvent,
  type ToolCallArgsEvent,
  type ToolCallEndEvent,
  type ToolCallResultEvent,
  type ToolCallStartEvent,
} from '@ag-ui/client'
import type {
  HermesApprovalRequiredPayload,
  HermesContextPayload,
  HermesCoworkProgressPayload,
  HermesCronFiredPayload,
  HermesSkillLearnedPayload,
  HermesTitlePayload,
} from '@hermes/shared'
import { useAgentStateStore } from '@app/stores/agentState'
import { useChatStore } from '@app/stores/chat'
import { useSessionsStore } from '@app/stores/sessions'
import { useUiStore } from '@app/stores/ui'
import { processA2UIMessage } from '@app/lib/a2ui/processor'
import { executeFrontendTool, isFrontendTool } from '@app/lib/agui/frontend-tools'
import { generateId } from '@app/lib/utils'
import type { ChatMessage } from '@app/stores/chat'
import type { AgentState } from '@app/types/hermes'
import type { Operation } from 'fast-json-patch'

export function dispatchAguiEvent(event: BaseEvent, sessionId: string | null): void {
  const chat = useChatStore.getState()
  const agentState = useAgentStateStore.getState()
  const sessions = useSessionsStore.getState()
  const ui = useUiStore.getState()

  switch (event.type) {
    case EventType.RUN_STARTED: {
      const e = event as RunStartedEvent
      chat.setRunStatus('running')
      chat.setRunId(e.runId ?? null)
      chat.setError(null)
      chat.clearStage()
      chat.setStage('starting')
      break
    }

    case EventType.RUN_FINISHED:
      chat.setStage('done')
      chat.setRunStatus('idle')
      chat.setRunId(null)
      // Finish any tools still marked executing (cancel / early finish races).
      for (const [id, tc] of Object.entries(chat.toolCalls)) {
        if (
          tc.status === 'executing' ||
          tc.status === 'pending' ||
          tc.status === 'streaming-args'
        ) {
          chat.upsertToolCall(id, { status: 'done' })
        }
      }
      window.setTimeout(() => {
        useChatStore.getState().clearStage()
      }, 1200)
      break

    case EventType.RUN_ERROR: {
      const e = event as RunErrorEvent
      chat.setError(e.message ?? 'Run failed')
      chat.setRunStatus('error')
      chat.setStage('error')
      for (const msgs of Object.values(chat.messagesBySession)) {
        for (const m of msgs) {
          if (m.streaming) {
            chat.flushStreamBuffer(m.id)
            chat.flushThinkingBuffer(m.id)
          }
        }
      }
      break
    }

    case EventType.STEP_STARTED: {
      const e = event as StepStartedEvent
      chat.addRunStep({
        id: String(e.stepId ?? generateId()),
        name: String(e.stepName ?? 'Step'),
        status: 'running',
      })
      break
    }

    case EventType.STEP_FINISHED: {
      const e = event as StepFinishedEvent
      if (e.stepId) chat.finishRunStep(String(e.stepId))
      break
    }

    case EventType.TEXT_MESSAGE_START: {
      const e = event as TextMessageStartEvent
      chat.setStage('writing')
      if (sessionId && e.messageId) {
        chat.addMessage(sessionId, {
          id: String(e.messageId),
          sessionId,
          runId: e.runId != null ? String(e.runId) : null,
          role: 'assistant',
          content: '',
          streaming: true,
          createdAt: new Date().toISOString(),
        })
      }
      break
    }

    case EventType.TEXT_MESSAGE_CONTENT: {
      const e = event as TextMessageContentEvent
      if (e.messageId && e.delta) {
        chat.appendStreamContent(e.messageId, e.delta)
      }
      break
    }

    case EventType.TEXT_MESSAGE_END: {
      const e = event as TextMessageEndEvent
      if (e.messageId) chat.flushStreamBuffer(e.messageId)
      break
    }

    case EventType.THINKING_START:
    case EventType.THINKING_END: {
      // Thinking step boundaries; per-message UI state is driven by the
      // THINKING_TEXT_MESSAGE_* events below.
      break
    }

    case EventType.THINKING_TEXT_MESSAGE_START: {
      const e = event as ThinkingTextMessageStartEvent
      chat.setStage('thinking')
      if (sessionId && e.messageId) {
        const msgId = String(e.messageId)
        const existing = (chat.messagesBySession[sessionId] ?? []).find(
          (m) => m.id === msgId,
        )
        if (!existing) {
          chat.addMessage(sessionId, {
            id: msgId,
            sessionId,
            runId: e.runId != null ? String(e.runId) : null,
            role: 'assistant',
            content: '',
            thinking: '',
            streaming: true,
            createdAt: new Date().toISOString(),
          })
        }
      }
      break
    }

    case EventType.THINKING_TEXT_MESSAGE_CONTENT: {
      const e = event as ThinkingTextMessageContentEvent
      const delta =
        typeof e.delta === 'string' ? e.delta : e.delta != null ? String(e.delta) : ''
      if (e.messageId && delta) {
        chat.appendThinking(String(e.messageId), delta)
      }
      break
    }

    case EventType.THINKING_TEXT_MESSAGE_END: {
      const e = event as { messageId?: string }
      if (e.messageId) chat.flushThinkingBuffer(String(e.messageId))
      break
    }

    case EventType.TOOL_CALL_START: {
      const e = event as ToolCallStartEvent & { parentMessageId?: string }
      chat.setStage('tool', e.toolCallName)
      if (e.toolCallId && e.toolCallName) {
        let messageId =
          e.parentMessageId != null ? String(e.parentMessageId) : undefined
        if (!messageId && sessionId) {
          const msgs = chat.messagesBySession[sessionId] ?? []
          messageId = [...msgs].reverse().find((m) => m.role === 'assistant')?.id
        }
        chat.upsertToolCall(e.toolCallId, {
          id: e.toolCallId,
          name: e.toolCallName,
          args: '',
          status: 'streaming-args',
          messageId,
        })
      }
      break
    }

    case EventType.TOOL_CALL_ARGS: {
      const e = event as ToolCallArgsEvent
      if (e.toolCallId && e.delta) {
        const tc = chat.toolCalls[e.toolCallId]
        chat.upsertToolCall(e.toolCallId, {
          args: (tc?.args ?? '') + e.delta,
          status: 'streaming-args',
        })
      }
      break
    }

    case EventType.TOOL_CALL_END: {
      const e = event as ToolCallEndEvent
      if (e.toolCallId) {
        chat.upsertToolCall(e.toolCallId, { status: 'executing' })
        const tc = chat.toolCalls[e.toolCallId]
        if (tc && isFrontendTool(tc.name)) {
          let args: Record<string, unknown> = {}
          try {
            args = JSON.parse(tc.args || '{}') as Record<string, unknown>
          } catch {
            args = {}
          }
          void executeFrontendTool(tc.name, args)
            .then((result) => {
              useChatStore.getState().upsertToolCall(e.toolCallId!, {
                result,
                status: 'done',
              })
            })
            .catch((err: unknown) => {
              useChatStore.getState().upsertToolCall(e.toolCallId!, {
                result: { error: String(err) },
                status: 'error',
              })
            })
        }
      }
      break
    }

    case EventType.TOOL_CALL_RESULT: {
      const e = event as ToolCallResultEvent
      const toolCallId = e.toolCallId != null ? String(e.toolCallId) : null
      if (toolCallId) {
        chat.upsertToolCall(toolCallId, {
          result: e.content,
          status: 'done',
        })
        const executing = Object.values(chat.toolCalls).some(
          (tc) => tc.id !== toolCallId && tc.status === 'executing',
        )
        if (!executing) chat.setStage('starting')
        if (sessionId) {
          chat.addMessage(sessionId, {
            id: generateId(),
            sessionId,
            runId: e.runId != null ? String(e.runId) : null,
            role: 'tool',
            content:
              typeof e.content === 'string' ? e.content : JSON.stringify(e.content),
            toolName: chat.toolCalls[toolCallId]?.name,
            createdAt: new Date().toISOString(),
          })
        }
      }
      break
    }

    case EventType.STATE_SNAPSHOT: {
      const e = event as StateSnapshotEvent
      if (e.snapshot) {
        agentState.setState(e.snapshot as AgentState)
      }
      break
    }

    case EventType.STATE_DELTA: {
      const e = event as StateDeltaEvent
      if (e.delta) {
        agentState.applyDelta(e.delta as Operation[])
      }
      break
    }

    case EventType.MESSAGES_SNAPSHOT: {
      const e = event as MessagesSnapshotEvent
      if (sessionId && e.messages) {
        chat.setMessages(
          sessionId,
          e.messages.map(
            (m): ChatMessage => ({
              id: m.id ?? generateId(),
              sessionId,
              runId: null,
              role: (m.role as ChatMessage['role']) ?? 'assistant',
              content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
              createdAt: new Date().toISOString(),
            }),
          ),
        )
      }
      break
    }

    case EventType.CUSTOM: {
      const e = event as CustomEvent
      const name = e.name
      const value = e.value
      if (name === 'hermes.context') {
        const payload = value as HermesContextPayload
        const used =
          payload.tokensUsed ?? payload.totalTokens ?? payload.promptTokens ?? 0
        const limit = payload.tokensMax ?? payload.contextLimit ?? 128_000
        chat.setContextUsage({ used, limit })
      } else if (name === 'hermes.title') {
        const payload = value as HermesTitlePayload
        if (sessionId) {
          sessions.updateSession(sessionId, { title: payload.title })
        }
      } else if (name === 'hermes.skill.learned') {
        const payload = value as HermesSkillLearnedPayload
        ui.addToast({
          title: 'Skill learned',
          description: payload.skillName,
          variant: 'success',
        })
      } else if (name === 'hermes.cron.fired') {
        const payload = value as HermesCronFiredPayload
        ui.addToast({
          title: 'Scheduled task fired',
          description: payload.jobName,
          variant: 'attention',
        })
      } else if (name === 'a2ui.message') {
        processA2UIMessage(value, sessionId)
      } else if (name === 'hermes.approval.required') {
        const payload = value as HermesApprovalRequiredPayload
        chat.setPendingApproval({
          toolCallId: payload.toolCallId,
          toolName: payload.toolName,
          args: (payload.args ?? {}) as Record<string, unknown>,
        })
      } else if (name === 'hermes.cowork.progress') {
        const payload = value as HermesCoworkProgressPayload & { line?: string }
        const line =
          (typeof payload.line === 'string' && payload.line.trim()) ||
          payload.text?.trim() ||
          (payload.phase === 'tool' && payload.tool
            ? `Running ${payload.tool}…`
            : payload.phase === 'started'
              ? `Open Cowork started (${payload.taskId})`
              : payload.phase === 'ended'
                ? `Open Cowork finished (${payload.taskId})`
                : payload.phase === 'error'
                  ? payload.text || 'Open Cowork error'
                  : '')
        if (line) {
          const toolCalls = chat.toolCalls
          const executing = Object.values(toolCalls).find(
            (tc) =>
              tc.name === 'delegate_to_cowork' &&
              (tc.status === 'executing' ||
                tc.status === 'pending' ||
                tc.status === 'streaming-args'),
          )
          if (executing) {
            const nextProgress =
              payload.phase === 'delta' && executing.progress
                ? `${executing.progress}${line}`.slice(-800)
                : line.slice(0, 800)
            chat.upsertToolCall(executing.id, { progress: nextProgress })
          }
        }
        if (payload.phase === 'ended' && payload.ok !== false) {
          ui.addToast({
            title: 'Open Cowork finished',
            description: payload.text?.slice(0, 120) || payload.taskId,
            variant: 'success',
          })
        } else if (payload.phase === 'error') {
          const aborted = /abort/i.test(payload.text ?? '')
          ui.addToast({
            title: aborted ? 'Open Cowork cancelled' : 'Open Cowork failed',
            description: payload.text?.slice(0, 160) || payload.taskId,
            variant: aborted ? 'attention' : 'danger',
          })
        }
      }
      break
    }

    default:
      break
  }
}
