import { create } from 'zustand'
import type { Message } from '@hermes/shared'

export type ToolCallStatus = 'pending' | 'streaming-args' | 'executing' | 'done' | 'error'

export interface ChatMessage {
  id: string
  sessionId: string
  runId: string | null
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  thinking?: string | null
  toolName?: string | null
  toolArgs?: Record<string, unknown> | null
  toolResult?: unknown
  a2ui?: unknown
  streaming?: boolean
  createdAt: string
}

export interface ToolCallState {
  id: string
  name: string
  args: string
  result?: unknown
  status: ToolCallStatus
  messageId?: string
}

export interface RunStep {
  id: string
  name: string
  status: 'running' | 'done'
}

export interface PendingApproval {
  toolCallId: string
  toolName: string
  args: Record<string, unknown>
}

export type RunStatus = 'idle' | 'running' | 'error' | 'cancelled'

interface ChatState {
  messagesBySession: Record<string, ChatMessage[]>
  toolCalls: Record<string, ToolCallState>
  runStatus: RunStatus
  runId: string | null
  runSteps: RunStep[]
  pendingApproval: PendingApproval | null
  error: string | null
  contextUsage: { used: number; limit: number } | null
  streamingBuffer: Record<string, string>
  recentEvents: string[]

  setMessages: (sessionId: string, messages: ChatMessage[]) => void
  addMessage: (sessionId: string, message: ChatMessage) => void
  appendStreamContent: (messageId: string, delta: string) => void
  flushStreamBuffer: (messageId: string) => void
  appendThinking: (messageId: string, delta: string) => void
  setRunStatus: (status: RunStatus) => void
  setRunId: (runId: string | null) => void
  setError: (error: string | null) => void
  setPendingApproval: (approval: PendingApproval | null) => void
  setContextUsage: (usage: { used: number; limit: number } | null) => void
  upsertToolCall: (id: string, patch: Partial<ToolCallState>) => void
  addRunStep: (step: RunStep) => void
  finishRunStep: (stepId: string) => void
  clearRunSteps: () => void
  recordEvent: (event: string) => void
  resetRun: () => void
  messageFromDto: (msg: Message) => ChatMessage
}

let flushScheduled = false
const pendingFlushes = new Set<string>()

function scheduleFlush(
  get: () => ChatState,
  set: (fn: (s: ChatState) => Partial<ChatState>) => void,
) {
  if (flushScheduled) return
  flushScheduled = true
  requestAnimationFrame(() => {
    flushScheduled = false
    const state = get()
    const updates: Record<string, string> = {}
    for (const messageId of pendingFlushes) {
      const delta = state.streamingBuffer[messageId]
      if (!delta) continue
      updates[messageId] = delta
    }
    pendingFlushes.clear()
    if (Object.keys(updates).length === 0) return

    set((s) => {
      const messagesBySession = { ...s.messagesBySession }
      for (const [sessionId, messages] of Object.entries(messagesBySession)) {
        messagesBySession[sessionId] = messages.map((m) => {
          const delta = updates[m.id]
          if (!delta) return m
          return { ...m, content: m.content + delta, streaming: true }
        })
      }
      const streamingBuffer = { ...s.streamingBuffer }
      for (const id of Object.keys(updates)) delete streamingBuffer[id]
      return { messagesBySession, streamingBuffer }
    })
  })
}

export const useChatStore = create<ChatState>()((set, get) => ({
  messagesBySession: {},
  toolCalls: {},
  runStatus: 'idle',
  runId: null,
  runSteps: [],
  pendingApproval: null,
  error: null,
  contextUsage: null,
  streamingBuffer: {},
  recentEvents: [],

  setMessages: (sessionId, messages) =>
    set((s) => ({ messagesBySession: { ...s.messagesBySession, [sessionId]: messages } })),

  addMessage: (sessionId, message) =>
    set((s) => ({
      messagesBySession: {
        ...s.messagesBySession,
        [sessionId]: [...(s.messagesBySession[sessionId] ?? []), message],
      },
    })),

  appendStreamContent: (messageId, delta) => {
    set((s) => ({
      streamingBuffer: {
        ...s.streamingBuffer,
        [messageId]: (s.streamingBuffer[messageId] ?? '') + delta,
      },
    }))
    pendingFlushes.add(messageId)
    scheduleFlush(get, set)
  },

  flushStreamBuffer: (messageId) => {
    const state = get()
    const delta = state.streamingBuffer[messageId]
    if (delta) {
      set((s) => {
        const messagesBySession = { ...s.messagesBySession }
        for (const [sessionId, messages] of Object.entries(messagesBySession)) {
          messagesBySession[sessionId] = messages.map((m) =>
            m.id === messageId
              ? { ...m, content: m.content + delta, streaming: false }
              : m,
          )
        }
        const streamingBuffer = { ...s.streamingBuffer }
        delete streamingBuffer[messageId]
        return { messagesBySession, streamingBuffer }
      })
    } else {
      set((s) => {
        const messagesBySession = { ...s.messagesBySession }
        for (const [sessionId, messages] of Object.entries(messagesBySession)) {
          messagesBySession[sessionId] = messages.map((m) =>
            m.id === messageId ? { ...m, streaming: false } : m,
          )
        }
        return { messagesBySession }
      })
    }
  },

  appendThinking: (messageId, delta) =>
    set((s) => {
      const messagesBySession = { ...s.messagesBySession }
      for (const [sessionId, messages] of Object.entries(messagesBySession)) {
        messagesBySession[sessionId] = messages.map((m) =>
          m.id === messageId ? { ...m, thinking: (m.thinking ?? '') + delta } : m,
        )
      }
      return { messagesBySession }
    }),

  setRunStatus: (runStatus) => set({ runStatus }),
  setRunId: (runId) => set({ runId }),
  setError: (error) => set({ error }),
  setPendingApproval: (pendingApproval) => set({ pendingApproval }),
  setContextUsage: (contextUsage) => set({ contextUsage }),

  upsertToolCall: (id, patch) =>
    set((s) => ({
      toolCalls: {
        ...s.toolCalls,
        [id]: { ...(s.toolCalls[id] ?? { id, name: '', args: '', status: 'pending' }), ...patch },
      },
    })),

  addRunStep: (step) => set((s) => ({ runSteps: [...s.runSteps, step] })),
  finishRunStep: (stepId) =>
    set((s) => ({
      runSteps: s.runSteps.map((step) =>
        step.id === stepId ? { ...step, status: 'done' } : step,
      ),
    })),
  clearRunSteps: () => set({ runSteps: [] }),

  recordEvent: (event) =>
    set((s) => ({
      recentEvents: [...s.recentEvents.slice(-49), event],
    })),

  resetRun: () =>
    set({
      runStatus: 'idle',
      runId: null,
      runSteps: [],
      pendingApproval: null,
      error: null,
    }),

  messageFromDto: (msg) => ({
    id: msg.id,
    sessionId: msg.sessionId,
    runId: msg.runId,
    role: msg.role,
    content: msg.content,
    thinking: msg.thinking,
    toolName: msg.toolName,
    toolArgs: msg.toolArgs,
    toolResult: msg.toolResult,
    a2ui: msg.a2ui,
    createdAt: msg.createdAt,
  }),
}))
