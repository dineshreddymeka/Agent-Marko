import { jsonResponse } from './helpers'

export async function handleDebug(req: Request, path: string): Promise<Response | null> {
  const parts = path.split('/').filter(Boolean)

  if (req.method === 'GET' && parts.length === 3 && parts[2] === 'health') {
    const { pingDatabase } = await import('../db/client')
    const { listActiveRuns } = await import('../agui/runs')
    const { getConnectionStates } = await import('../mcp/manager')
    const { queueDepth } = await import('../vector/indexer')
    const { getComputePoolStatus } = await import('../compute/pool')
    const { activeCronCount } = await import('../cron/scheduler')

    const dbOk = await pingDatabase()
    return jsonResponse({
      status: dbOk ? 'ok' : 'degraded',
      database: dbOk ? 'connected' : 'unreachable',
      activeRuns: listActiveRuns().length,
      mcp: getConnectionStates(),
      embeddingQueue: queueDepth(),
      compute: getComputePoolStatus(),
      cronJobs: activeCronCount(),
      memory: process.memoryUsage(),
      uptime: process.uptime(),
    })
  }

  if (req.method === 'GET' && parts.length === 3 && parts[2] === 'runs') {
    const url = new URL(req.url)
    const limit = Number(url.searchParams.get('limit') ?? 20)
    const { isDatabaseAvailable } = await import('./db-guard')
    if (!(await isDatabaseAvailable())) {
      const { listBufferedRuns } = await import('../agui/run-event-buffer')
      return jsonResponse({ runs: listBufferedRuns(Math.min(limit, 100)), source: 'memory' })
    }
    const { runEventsRepo } = await import('../db/repositories/run_events')
    const runs = await runEventsRepo.listRecentRuns(Math.min(limit, 100))
    return jsonResponse({ runs, source: 'postgres' })
  }

  if (req.method === 'GET' && parts.length === 5 && parts[2] === 'runs' && parts[4] === 'events') {
    const runId = parts[3]!
    const { isDatabaseAvailable } = await import('./db-guard')
    if (!(await isDatabaseAvailable())) {
      const { getBufferedRunEvents } = await import('../agui/run-event-buffer')
      return jsonResponse({ runId, events: getBufferedRunEvents(runId), source: 'memory' })
    }
    const { runEventsRepo } = await import('../db/repositories/run_events')
    const events = await runEventsRepo.listByRun(runId)
    return jsonResponse({ runId, events, source: 'postgres' })
  }

  return null
}
