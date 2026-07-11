import { useEffect } from 'react'
import { ChatColumn } from '@app/components/shell/ChatColumn'
import { useSessionsStore } from '@app/stores/sessions'
import { loadSessionMessages, checkLiveRun } from '@app/lib/agui/client'

export function HomePage() {
  const setActiveSessionId = useSessionsStore((s) => s.setActiveSessionId)

  useEffect(() => {
    setActiveSessionId(null)
  }, [setActiveSessionId])

  return <ChatColumn />
}

export function SessionPage({ sessionId }: { sessionId: string }) {
  const setActiveSessionId = useSessionsStore((s) => s.setActiveSessionId)

  useEffect(() => {
    setActiveSessionId(sessionId)
    void loadSessionMessages(sessionId)
    void checkLiveRun(sessionId)
  }, [sessionId, setActiveSessionId])

  return <ChatColumn sessionId={sessionId} />
}
