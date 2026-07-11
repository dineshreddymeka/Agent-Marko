import { useEffect } from 'react'
import { MessageSquare } from 'lucide-react'
import { Composer } from '@app/components/chat/Composer'
import { MessageList } from '@app/components/chat/MessageList'
import { RunProgress } from '@app/components/chat/RunProgress'
import { ErrorBanner } from '@app/components/chat/ErrorBanner'
import { ApprovalCard } from '@app/components/chat/ApprovalCard'
import { EmptyState } from '@app/components/common/EmptyState'
import { checkLiveRun, loadSessionMessages } from '@app/lib/agui/client'
import { useChatStore } from '@app/stores/chat'
import { useSessionsStore } from '@app/stores/sessions'

import type { ChatMessage } from '@app/stores/chat'

const EMPTY_MESSAGES: ChatMessage[] = []

interface ChatColumnProps {
  sessionId?: string
}

export function ChatColumn({ sessionId }: ChatColumnProps) {
  const pendingApproval = useChatStore((s) => s.pendingApproval)
  const messages = useChatStore((s) =>
    sessionId ? (s.messagesBySession[sessionId] ?? EMPTY_MESSAGES) : EMPTY_MESSAGES,
  )
  const sessions = useSessionsStore((s) => s.sessions)
  const activeSession = sessionId ? sessions.find((s) => s.id === sessionId) : null

  useEffect(() => {
    if (!sessionId) return
    void loadSessionMessages(sessionId)
    void checkLiveRun(sessionId)
  }, [sessionId])

  return (
    <main className="flex min-w-0 flex-1 flex-col bg-canvas">
      <header className="flex h-12 shrink-0 items-center border-b border-border px-4">
        <h1 className="truncate text-sm font-medium text-fg">
          {activeSession?.title ?? (sessionId ? 'Chat' : 'New chat')}
        </h1>
      </header>

      <RunProgress />
      <ErrorBanner />

      <div className="min-h-0 flex-1">
        {messages.length > 0 ? (
          <MessageList messages={messages} />
        ) : (
          <EmptyState
            icon={<MessageSquare size={22} strokeWidth={1.5} />}
            title="How can I help you today?"
            description="Send a message to start a conversation with Hermes."
            className="h-full"
          />
        )}
      </div>

      {pendingApproval ? <ApprovalCard approval={pendingApproval} /> : null}

      <Composer sessionId={sessionId ?? null} />
    </main>
  )
}
