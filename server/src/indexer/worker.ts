import { getSql } from '../db/client'
import { indexerRepo } from '../db/repositories/indexer'
import { config } from '../config'
import { logger } from '../log'
import { INDEX_JOBS_CHANNEL, onIndexJobWake } from './notify'
import { backfillPendingEmbeddings, processIndexJob } from './service'
import { scanWorkspace } from './scanner'

const log = logger.child({ component: 'indexer-worker' })

let running = false
let drainRequested = false
let started = false
let timer: ReturnType<typeof setInterval> | null = null
let unsubscribeWake: (() => void) | null = null
let unlistenNotify: (() => void | Promise<void>) | null = null

export async function drainIndexJobs(limit = 16): Promise<number> {
  if (!config.INDEXER_ENABLED) return 0
  if (running) {
    drainRequested = true
    return 0
  }
  running = true
  let processed = 0
  try {
    do {
      drainRequested = false
      for (;;) {
        const jobs = await indexerRepo.claimJobs(limit)
        if (jobs.length === 0) break
        for (const job of jobs) {
          try {
            await processIndexJob(job)
            const completed = await indexerRepo.completeJob(job.id, job.lockToken)
            processed++
            if (completed.rerunRequested && completed.sourceId) {
              await indexerRepo.enqueueJob({
                sourceType: completed.sourceType,
                sourceId: completed.sourceId,
                operation: completed.operation,
                actionId: job.actionId,
                sessionId: job.sessionId,
                runId: job.runId,
                userId: job.userId,
                metadata: job.metadata,
                priority: 1,
              })
            }
          } catch (err) {
            await indexerRepo.failJob(job.id, job.lockToken, err)
            log.warn('Index job failed', {
              jobId: job.id,
              sourceType: job.sourceType,
              sourceId: job.sourceId,
              error: String(err),
            })
          }
        }
      }
    } while (drainRequested)
    const backfilled = await backfillPendingEmbeddings(8).catch((err) => {
      log.warn('Embedding backfill failed', { error: String(err) })
      return 0
    })
    if (backfilled > 0) {
      log.info('Backfilled pending embeddings', { backfilled })
    }
  } finally {
    running = false
  }
  return processed
}

function scheduleDrain(): void {
  if (!config.INDEXER_ENABLED) return
  void drainIndexJobs().catch((err) => {
    log.warn('Index drain failed', { error: String(err) })
  })
}

async function startNotifyListener(): Promise<void> {
  const sql = getSql() as {
    listen?: (
      channel: string,
      onNotify: (payload: string) => void,
    ) => Promise<{ unlisten: () => void | Promise<void> }>
  }
  if (typeof sql.listen !== 'function') {
    log.info('Postgres LISTEN API unavailable; using pg_notify + in-process wake + fallback poll')
    return
  }
  try {
    const sub = await sql.listen(INDEX_JOBS_CHANNEL, () => {
      scheduleDrain()
    })
    unlistenNotify = () => sub.unlisten()
    log.info('Listening for indexer job notifications', { channel: INDEX_JOBS_CHANNEL })
  } catch (err) {
    log.warn('Failed to LISTEN for indexer jobs; fallback poll remains active', {
      error: String(err),
    })
  }
}

export async function startIndexerWorker(opts?: {
  scanOnStart?: boolean
  intervalMs?: number
}): Promise<void> {
  if (started) return
  if (!config.INDEXER_ENABLED) {
    log.info('Indexer disabled (INDEXER_ENABLED=false)')
    return
  }
  started = true

  unsubscribeWake = onIndexJobWake(scheduleDrain)
  await startNotifyListener()

  const scanOnStart = opts?.scanOnStart ?? config.INDEXER_SCAN_ON_START
  if (scanOnStart) {
    void scanWorkspace()
      .then(() => drainIndexJobs())
      .catch((err) => {
        log.warn('Workspace index scan/drain failed', { error: String(err) })
      })
  } else {
    void drainIndexJobs().catch((err) => {
      log.warn('Initial index drain failed', { error: String(err) })
    })
  }

  timer = setInterval(scheduleDrain, opts?.intervalMs ?? config.INDEXER_POLL_MS)
  timer.unref?.()
}

export function stopIndexerWorker(): void {
  if (timer) clearInterval(timer)
  timer = null
  unsubscribeWake?.()
  unsubscribeWake = null
  void unlistenNotify?.()
  unlistenNotify = null
  started = false
}
