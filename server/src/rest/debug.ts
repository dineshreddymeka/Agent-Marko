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
    const { getCleanupStatus } = await import('../cleanup/worker')

    const dbOk = await pingDatabase()
    const { getDbMetrics } = await import('../db/client')
    const dbMetrics = dbOk ? await getDbMetrics() : null
    const { oauthProvidersConfigured } = await import('../auth')
    const { config } = await import('../config')
    const { getLlmDebugInfo } = await import('../health')
    const microsoftConfigured = Boolean(
      config.MICROSOFT_CLIENT_ID?.trim() && config.MICROSOFT_CLIENT_SECRET?.trim(),
    )
    const microsoftMissingEnv = [
      !config.MICROSOFT_CLIENT_ID?.trim() ? 'MICROSOFT_CLIENT_ID' : null,
      !config.MICROSOFT_CLIENT_SECRET?.trim() ? 'MICROSOFT_CLIENT_SECRET' : null,
    ].filter(Boolean)
    return jsonResponse({
      status: dbOk ? 'ok' : 'degraded',
      product: 'Open Jarvis',
      database: dbOk ? 'connected' : 'unreachable',
      db: dbOk,
      dbMetrics,
      activeRuns: listActiveRuns().length,
      mcp: getConnectionStates(),
      embeddingQueue: queueDepth(),
      jarvisIndexer: await import('../db/repositories/indexer')
        .then(({ indexerRepo }) => indexerRepo.status())
        .catch(() => null),
      compute: getComputePoolStatus(),
      cronJobs: activeCronCount(),
<<<<<<< HEAD
      oauthProviders: oauthProvidersConfigured(),
      microsoftSso: {
        configured: microsoftConfigured,
        missingEnv: microsoftMissingEnv,
        autoSso: config.MICROSOFT_SSO_AUTO,
      },
      llm: getLlmDebugInfo(),
=======
      cleanup: getCleanupStatus(),
>>>>>>> origin/cursor/setup-dev-environment-9393
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
