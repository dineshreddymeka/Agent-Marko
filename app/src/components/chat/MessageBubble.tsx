import { User, Bot } from 'lucide-react'
import { StreamingMarkdown } from '@app/components/chat/StreamingMarkdown'
import { ThinkingBlock } from '@app/components/chat/ThinkingBlock'
import { ToolCallCard } from '@app/components/chat/ToolCallCard'
import { A2UISurface } from '@app/components/a2ui/A2UISurface'
import type { ChatMessage } from '@app/stores/chat'
import { useChatStore } from '@app/stores/chat'
import { cn } from '@app/lib/utils'

interface MessageBubbleProps {
  message: ChatMessage
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const toolCalls = useChatStore((s) => s.toolCalls)
  const isUser = message.role === 'user'

  const relatedTools = Object.values(toolCalls).filter(
    (tc) => tc.messageId === message.id || message.toolName === tc.name,
  )

  return (
    <div
      className={cn(
        'mb-4 flex gap-3',
        isUser ? 'flex-row-reverse' : 'flex-row',
      )}
    >
      <div
        className={cn(
          'flex h-7 w-7 shrink-0 items-center justify-center rounded-full',
          isUser ? 'bg-accent-muted text-accent' : 'bg-canvas-inset text-fg-muted',
        )}
      >
        {isUser ? <User size={14} /> : <Bot size={14} />}
      </div>
      <div className={cn('min-w-0 flex-1', isUser && 'text-right')}>
        {message.thinking && <ThinkingBlock content={message.thinking} />}
        {message.content && (
          <div
            className={cn(
              'inline-block max-w-full rounded-lg px-3 py-2 text-left text-sm',
              isUser
                ? 'bg-accent text-white'
                : 'bg-canvas-subtle text-fg',
            )}
          >
            {isUser ? (
              <p className="whitespace-pre-wrap">{message.content}</p>
            ) : (
              <StreamingMarkdown content={message.content} streaming={message.streaming} />
            )}
          </div>
        )}
        {relatedTools.map((tc) => (
          <ToolCallCard key={tc.id} toolCall={tc} />
        ))}
        {message.a2ui != null && (
          <A2UISurface surfaceId={String(message.a2ui)} />
        )}
      </div>
    </div>
  )
}
