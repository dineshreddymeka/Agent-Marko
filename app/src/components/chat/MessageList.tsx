import { useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { MessageBubble } from '@app/components/chat/MessageBubble'
import type { ChatMessage } from '@app/stores/chat'

interface MessageListProps {
  messages: ChatMessage[]
}

export function MessageList({ messages }: MessageListProps) {
  const parentRef = useRef<HTMLDivElement>(null)

  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 120,
    overscan: 5,
  })

  return (
    <div ref={parentRef} className="h-full overflow-y-auto px-4 py-4">
      <div
        className="mx-auto max-w-3xl"
        style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }}
      >
        {virtualizer.getVirtualItems().map((item) => {
          const message = messages[item.index]
          if (!message) return null
          return (
            <div
              key={message.id}
              data-index={item.index}
              ref={virtualizer.measureElement}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${item.start}px)`,
              }}
            >
              <MessageBubble message={message} />
            </div>
          )
        })}
      </div>
    </div>
  )
}
