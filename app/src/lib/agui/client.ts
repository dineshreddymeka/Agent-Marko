import { HttpAgent } from '@ag-ui/client'
import type { Message, RunAgentInput } from '@ag-ui/client'
import { dispatchAguiEvent } from '@app/lib/agui/dispatcher'
import { getFrontendTools } from '@app/lib/agui/frontend-tools'
import { useAgentStateStore } from '@app/stores/agentState'
import { useChatStore } from '@app/stores/chat'
import { apiClient } from '@app/lib/api'
import { generateId } from '@app/lib/utils'

export type ApprovalDecision = 'approve' | 'reject' | 'always' | 'always_tool'

let agent: HttpAgent | null = null
let currentSessionId: string | null = null

function getAgent(sessionId: string): HttpAgent {
  if (!agent || agent.threadId !== sessionId) {
    agent = new HttpAgent({
      url: '/agui',
      threadId: sessionId,
    })
    agent.subscribe({
      onEvent: ({ event }) => {
        dispatchAguiEvent(event, currentSessionId)
        useChatStore.getState().recordEvent(JSON.stringify(event))
      },
    })
  }
  return agent
}

function toAguiMessages(
  messages: ReturnType<typeof useChatStore.getState>['messagesBySession'][string],
): Message[] {
  return (messages ?? []).map((m) => {
    if (m.role === 'tool') {
      return {
        id: m.id,
        role: 'tool' as const,
        content: m.content,
        toolCallId: m.toolName ?? m.id,
      }
    }
    if (m.role === 'assistant') {
      return { id: m.id, role: 'assistant' as const, content: m.content }
    }
    if (m.role === 'system') {
      return { id: m.id, role: 'system' as const, content: m.content }
    }
    return { id: m.id, role: 'user' as const, content: m.content }
  })
}

/**
 * Build AG-UI messages from a fresh Zustand snapshot.
 * Never reuse a pre-mutation `getState()` handle — Zustand state is immutable,
 * so reading `messagesBySession` off a stale snapshot omits the optimistic
 * user turn and makes the LLM answer one turn behind.
 */
export function getAguiMessagesForSession(sessionId: string): Message[] {
  return toAguiMessages(useChatStore.getState().messagesBySession[sessionId] ?? [])
}

export async function runAgent(input: {
  sessionId: string
  content: string
  profileId?: string | null
  /** When true, do not append a new user message (retry after error). */
  reuseLastUserMessage?: boolean
}): Promise<void> {
  const { sessionId, content, reuseLastUserMessage } = input
  currentSessionId = sessionId

  // Cancel any in-flight run so late SSE chunks cannot attach to the next turn.
  const prior = useChatStore.getState()
  if (prior.runStatus === 'running' && agent) {
    agent.abortRun()
  }

  const runId = generateId()
  const chat = useChatStore.getState()
  const agentState = useAgentStateStore.getState().state
  const httpAgent = getAgent(sessionId)

  chat.setRunId(runId)
  chat.setRunStatus('running')
  chat.setError(null)
  chat.clearRunSteps()
  chat.clearStage()
  chat.setStage('starting')

  if (!reuseLastUserMessage) {
    const userMessage = {
      id: generateId(),
      sessionId,
      runId,
      role: 'user' as const,
      content,
      createdAt: new Date().toISOString(),
    }
    chat.addMessage(sessionId, userMessage)
  }

  // Fresh snapshot after addMessage — `chat` still points at the pre-add state.
  const allMessages = getAguiMessagesForSession(sessionId)
  httpAgent.setMessages(allMessages)
  httpAgent.setState(agentState)

  const runInput: RunAgentInput = {
    threadId: sessionId,
    runId,
    messages: httpAgent.messages,
    tools: getFrontendTools(),
    state: agentState,
    context: [],
  }

  try {
    await httpAgent.runAgent({ runId, tools: runInput.tools, context: runInput.context })
    // Ignore completion if a newer run already replaced this one.
    if (useChatStore.getState().runId === runId) {
      useChatStore.getState().setRunStatus('idle')
    }
  } catch (err) {
    const state = useChatStore.getState()
    if (state.runId !== runId) return
    const message = err instanceof Error ? err.message : 'Agent run failed'
    // Clear streaming flags so Thinking/"Analyzing…" cannot stick forever.
    for (const msgs of Object.values(state.messagesBySession)) {
      for (const m of msgs) {
        if (m.streaming) state.flushStreamBuffer(m.id)
      }
    }
    state.setError(message)
    state.setRunStatus('error')
  }
}

/** Re-run the last user turn without duplicating the user message. */
export async function retryLastRun(sessionId: string): Promise<void> {
  const messages = useChatStore.getState().messagesBySession[sessionId] ?? []
  const lastUser = [...messages].reverse().find((m) => m.role === 'user')
  if (!lastUser?.content) {
    useChatStore.getState().setError(null)
    useChatStore.getState().setRunStatus('idle')
    return
  }
  await runAgent({
    sessionId,
    content: lastUser.content,
    reuseLastUserMessage: true,
  })
}

export function cancelRun(): void {
  if (agent) agent.abortRun()
  const chat = useChatStore.getState()
  chat.setRunStatus('cancelled')
  // Clear stuck tool cards (abort may skip a clean TOOL_CALL_RESULT race).
  for (const [id, tc] of Object.entries(chat.toolCalls)) {
    if (
      tc.status === 'executing' ||
      tc.status === 'pending' ||
      tc.status === 'streaming-args'
    ) {
      chat.upsertToolCall(id, {
        status: 'error',
        result: { error: 'Cancelled' },
        progressLines: tc.progressLines,
        progressLive: tc.progressLive,
      })
    }
  }
}

export async function respondToApproval(
  decision: ApprovalDecision,
  toolCallId: string,
): Promise<void> {
  const chat = useChatStore.getState()
  chat.setPendingApproval(null)

  try {
    await apiClient.post<{ ok: boolean }>('/api/approval/resolve', { toolCallId, decision })
    if (decision === 'reject') {
      chat.setError('Tool call rejected')
      chat.setRunStatus('error')
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to send approval'
    chat.setError(message)
    chat.setRunStatus('error')
  }
}

export interface ApprovalConfig {
  autoApproveAll: boolean
  toolWhitelist: string[]
  sessionWhitelist: string[]
}

export async function fetchApprovalConfig(): Promise<ApprovalConfig> {
  return apiClient.get<ApprovalConfig>('/api/approval/config')
}

export async function saveApprovalConfig(
  patch: Partial<Pick<ApprovalConfig, 'autoApproveAll' | 'toolWhitelist'>>,
): Promise<ApprovalConfig> {
  return apiClient.put<ApprovalConfig>('/api/approval/config', patch)
}

/**
 * Hydrate messages from the API without clobbering an in-flight transcript.
 * Stale empty fetches (StrictMode remount / navigate-during-send) previously
 * wiped optimistic user + streamed assistant bubbles after the run finished.
 */
export async function loadSessionMessages(
  sessionId: string,
  opts?: { signal?: AbortSignal },
): Promise<void> {
  const res = await fetch(`/api/sessions/${sessionId}/messages`, {
    credentials: 'include',
    signal: opts?.signal,
  })
  if (opts?.signal?.aborted) return
  if (!res.ok) {
    if (res.status === 404) return
    throw new Error(`Failed to load messages (${res.status})`)
  }
  const messages = (await res.json()) as import('@hermes/shared').Message[]
  if (opts?.signal?.aborted) return

  const chat = useChatStore.getState()
  const existing = chat.messagesBySession[sessionId] ?? []
  const loaded = messages.map((m) => chat.messageFromDto(m))

  // Empty server snapshot must not erase local optimistic/streamed messages
  // (navigate + StrictMode remount often fetch before the runtime insert commits).
  if (loaded.length === 0 && existing.length > 0) return

  chat.setMessages(sessionId, mergeSessionMessages(loaded, existing))
}

/** Prefer server rows; keep local-only optimistic/streaming rows not yet on the server. */
function mergeSessionMessages(
  server: ReturnType<typeof useChatStore.getState>['messagesBySession'][string],
  local: ReturnType<typeof useChatStore.getState>['messagesBySession'][string],
): NonNullable<ReturnType<typeof useChatStore.getState>['messagesBySession'][string]> {
  const serverList = server ?? []
  const localList = local ?? []
  if (localList.length === 0) return serverList
  if (serverList.length === 0) return localList

  const byId = new Map(serverList.map((m) => [m.id, m]))
  const serverFingerprints = new Set(
    serverList.map((m) => `${m.role}\0${m.content}`),
  )
  for (const m of localList) {
    if (byId.has(m.id)) continue
    // Client optimistic user ids differ from server-generated ids — skip dupes by content.
    if (m.content && serverFingerprints.has(`${m.role}\0${m.content}`)) continue
    byId.set(m.id, m)
  }
  return [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

export async function checkLiveRun(sessionId: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/sessions/${sessionId}/live`, { credentials: 'include' })
    if (!res.ok) return false
    const data = (await res.json()) as { live: boolean; runId?: string | null }
    if (data.live && data.runId) {
      currentSessionId = sessionId
      getAgent(sessionId)
      useChatStore.getState().setRunId(data.runId)
      useChatStore.getState().setRunStatus('running')
      return true
    }
  } catch {
    // endpoint not available
  }
  return false
}

/** While a recovered run is live, refresh messages until the run ends. */
export function startLiveMessagePoll(sessionId: string): () => void {
  let stopped = false
  const tick = async () => {
    if (stopped) return
    try {
      await loadSessionMessages(sessionId)
      const stillLive = await checkLiveRun(sessionId)
      if (!stillLive) {
        useChatStore.getState().setRunStatus('idle')
        stopped = true
        return
      }
    } catch {
      /* ignore transient poll errors */
    }
    if (!stopped) window.setTimeout(() => void tick(), 1500)
  }
  void tick()
  return () => {
    stopped = true
  }
}
