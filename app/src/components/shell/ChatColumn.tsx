import { Composer } from '@app/components/chat/Composer'
import { MessageList } from '@app/components/chat/MessageList'
import { RunProgress } from '@app/components/chat/RunProgress'
import { ErrorBanner } from '@app/components/chat/ErrorBanner'
import { ApprovalCard } from '@app/components/chat/ApprovalCard'
import { EmptyState } from '@app/components/common/EmptyState'
import { MessageSquare } from 'lucide-react'
import { useSessionsStore } from '@app/stores/sessions'
import { useChatStore } from '@app/stores/chat'

interface ChatColumnProps {
  sessionId?: string
}

export function ChatColumn({ sessionId }: ChatColumnProps) {
  const activeId = useSessionsStore((s) => s.activeSessionId)
  const sid = sessionId ?? activeId
  const messages = useChatStore((s) => (sid ? s.messagesBySession[sid] ?? [] : []))
  const pendingApproval = useChatStore((s) => s.pendingApproval)

  return (
    <main className="flex min-w-0 flex-1 flex-col">
      <div className="flex-1 overflow-hidden">
        {sid && messages.length > 0 ? (
          <MessageList messages={messages} />
        ) : (
          <EmptyState
            icon={<MessageSquare size={32} />}
            title="Start a conversation"
            description="Ask Hermes anything. Use / for slash commands."
            className="h-full"
          />
        )}
      </div>
      <div className="shrink-0 border-t border-border bg-canvas">
        <RunProgress />
        <ErrorBanner />
        {pendingApproval && <ApprovalCard approval={pendingApproval} />}
        <Composer sessionId={sid} />
      </div>
    </main>
  )
}
