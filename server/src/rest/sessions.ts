import { jsonResponse, parseJson } from './helpers'
import { requireDatabaseOrResponse, withDatabase } from './db-guard'

export async function handleSessions(req: Request, path: string): Promise<Response | null> {
  const { sessionsRepo } = await import('../db/repositories/sessions')
  const parts = path.split('/').filter(Boolean)

  if (req.method === 'GET' && parts.length === 2) {
    const sessions = await withDatabase(() => sessionsRepo.list(), [])
    return jsonResponse(sessions)
  }

  if (req.method === 'POST' && parts.length === 2) {
    const unavailable = await requireDatabaseOrResponse()
    if (unavailable) return unavailable
    const body = await parseJson(req)
    const session = await sessionsRepo.create(body ?? {})
    return jsonResponse(session, 201)
  }

  if (parts.length === 3) {
    const id = parts[2]!
    if (req.method === 'GET') {
      const session = await sessionsRepo.getById(id)
      if (!session) return jsonResponse({ error: 'Not found' }, 404)
      return jsonResponse(session)
    }
    if (req.method === 'PATCH') {
      const body = await parseJson(req)
      const session = await sessionsRepo.update(id, body ?? {})
      if (!session) return jsonResponse({ error: 'Not found' }, 404)
      return jsonResponse(session)
    }
    if (req.method === 'DELETE') {
      const ok = await sessionsRepo.delete(id)
      return jsonResponse({ deleted: ok })
    }
  }

  if (parts.length === 4 && parts[3] === 'live' && req.method === 'GET') {
    const { listActiveRuns } = await import('../agui/runs')
    const run = listActiveRuns().find((r) => r.threadId === parts[2])
    return jsonResponse({ live: !!run, runId: run?.runId ?? null })
  }

  return null
}
