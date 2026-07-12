import { jsonResponse } from './helpers'
<<<<<<< HEAD
=======
import { requireDatabaseOrResponse } from './db-guard'
>>>>>>> origin/main

export async function handleMessages(req: Request, path: string): Promise<Response | null> {
  const { messagesRepo } = await import('../db/repositories/messages')
  const parts = path.split('/').filter(Boolean)

  if (parts.length === 4 && parts[3] === 'messages' && req.method === 'GET') {
    const unavailable = await requireDatabaseOrResponse()
    if (unavailable) return unavailable
    const sessionId = parts[2]!
    const messages = await messagesRepo.listBySession(sessionId)
    return jsonResponse(messages)
  }

  return null
}
