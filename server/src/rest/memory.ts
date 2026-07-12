import { jsonResponse, parseJson } from './helpers'
import { requireDatabaseOrResponse, withDatabase } from './db-guard'

export async function handleMemory(req: Request, path: string): Promise<Response | null> {
  const { memoryRepo } = await import('../db/repositories/memory')
  const parts = path.split('/').filter(Boolean)

  if (req.method === 'GET' && parts.length === 2) {
    const url = new URL(req.url)
    const kind = url.searchParams.get('kind') as 'semantic' | 'episodic' | 'preference' | null
    const entries = await withDatabase(
      () => memoryRepo.list(kind ? { kind } : undefined),
      [],
    )
    return jsonResponse(entries)
  }

  if (req.method === 'POST' && parts.length === 2) {
    const unavailable = await requireDatabaseOrResponse()
    if (unavailable) return unavailable
    const body = await parseJson(req)
    if (!body?.kind || !body?.content) {
      return jsonResponse({ error: 'kind and content required' }, 400)
    }
    const entry = await memoryRepo.create({
      kind: body.kind as 'semantic' | 'episodic' | 'preference',
      content: String(body.content),
      sourceSession: body.sourceSession ? String(body.sourceSession) : null,
      importance: typeof body.importance === 'number' ? body.importance : 0.5,
    })
    const { queueEmbedding } = await import('../vector/indexer')
    queueEmbedding('memory', entry.id, entry.content)
    return jsonResponse(entry, 201)
  }

  if (parts.length === 3) {
    const id = parts[2]!
    if (req.method === 'GET') {
      const entries = await withDatabase(() => memoryRepo.list(), [])
      const entry = entries.find((e) => e.id === id)
      if (!entry) return jsonResponse({ error: 'Not found' }, 404)
      return jsonResponse(entry)
    }
    if (req.method === 'PATCH') {
      const body = await parseJson(req)
      const entry = await memoryRepo.update(id, body ?? {})
      if (!entry) return jsonResponse({ error: 'Not found' }, 404)
      const { queueEmbedding } = await import('../vector/indexer')
      queueEmbedding('memory', entry.id, entry.content)
      return jsonResponse(entry)
    }
    if (req.method === 'DELETE') {
      const deleted = await memoryRepo.delete(id)
      if (deleted) {
        void import('../indexer/service')
          .then(({ queueRuntimeDelete }) => queueRuntimeDelete('memory', id))
          .catch((err) => {
            void import('../log').then(({ logger }) =>
              logger.warn('Failed to queue memory index delete', { id, error: String(err) }),
            )
          })
      }
      return jsonResponse({ deleted })
    }
  }

  return null
}
