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

export async function runAgent(input: {
  sessionId: string
  content: string
  profileId?: string | null
}): Promise<void> {
  const { sessionId, content } = input
  currentSessionId = sessionId
  const runId = generateId()
  const chat = useChatStore.getState()
  const agentState = useAgentStateStore.getState().state
  const httpAgent = getAgent(sessionId)

  chat.setRunId(runId)
  chat.setRunStatus('running')
  chat.setError(null)
  chat.clearRunSteps()

  const userMessage = {
    id: generateId(),
    sessionId,
    runId,
    role: 'user' as const,
    content,
    createdAt: new Date().toISOString(),
  }
  chat.addMessage(sessionId, userMessage)

  const allMessages = [...(chat.messagesBySession[sessionId] ?? []), userMessage]
  httpAgent.setMessages(toAguiMessages(allMessages))
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
    chat.setRunStatus('idle')
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Agent run failed'
    chat.setError(message)
    chat.setRunStatus('error')
  }
}

export function cancelRun(): void {
  if (agent) agent.abortRun()
  useChatStore.getState().setRunStatus('cancelled')
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

export async function loadSessionMessages(sessionId: string): Promise<void> {
  try {
    const res = await fetch(`/api/sessions/${sessionId}/messages`, {
      credentials: 'include',
    })
    if (!res.ok) return
    const messages = (await res.json()) as import('@hermes/shared').Message[]
    const chat = useChatStore.getState()
    chat.setMessages(
      sessionId,
      messages.map((m) => chat.messageFromDto(m)),
    )
  } catch {
    // REST not available yet
  }
}

export async function checkLiveRun(sessionId: string): Promise<void> {
  try {
    const res = await fetch(`/api/sessions/${sessionId}/live`, { credentials: 'include' })
    if (!res.ok) return
    const data = (await res.json()) as { live: boolean; runId?: string }
    if (data.live && data.runId) {
      useChatStore.getState().setRunId(data.runId)
      useChatStore.getState().setRunStatus('running')
    }
  } catch {
    // endpoint not available
  }
}
