import { indexerRepo } from '../db/repositories/indexer'
import { config } from '../config'
import { drainIndexJobs } from '../indexer/worker'
import { scanWorkspace } from '../indexer/scanner'
import { jsonResponse, parseJson } from './helpers'
import { requireDatabaseOrResponse } from './db-guard'

export async function handleIndexer(req: Request, path: string): Promise<Response | null> {
  const parts = path.split('/').filter(Boolean)
  if (parts.length < 2) return null

  if (req.method === 'GET' && parts.length === 3 && parts[2] === 'status') {
    const unavailable = await requireDatabaseOrResponse()
    if (unavailable) return unavailable
    return jsonResponse(await indexerRepo.status())
  }

  if (req.method === 'POST' && parts.length === 3 && parts[2] === 'reindex') {
    const unavailable = await requireDatabaseOrResponse()
    if (unavailable) return unavailable
    const queued = await scanWorkspace()
    void drainIndexJobs().catch(() => undefined)
    return jsonResponse({ queued })
  }

  if (req.method === 'POST' && parts.length === 3 && parts[2] === 'drain') {
    const unavailable = await requireDatabaseOrResponse()
    if (unavailable) return unavailable
    return jsonResponse({ processed: await drainIndexJobs() })
  }

  if (req.method === 'POST' && parts.length === 3 && parts[2] === 'prune') {
    const unavailable = await requireDatabaseOrResponse()
    if (unavailable) return unavailable
    const body = await parseJson(req).catch(() => null)
    const days =
      typeof body?.days === 'number' ? body.days : Number(body?.days ?? config.INDEXER_PRUNE_DAYS)
    return jsonResponse(await indexerRepo.prune(days))
  }

  return null
}
