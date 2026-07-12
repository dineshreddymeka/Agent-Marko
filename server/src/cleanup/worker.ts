/**
 * Background cleanup worker — runs in parallel with the cron scheduler and
 * periodically prunes stale runtime state:
 *   - old `run_events` rows (Postgres)
 *   - old archived sessions (Postgres; messages cascade)
 *   - stale in-memory debug run buffer entries
 *   - leftover sandbox temp files under `HERMES_DATA_DIR/sandbox`
 *
 * All retention windows are configurable via `CLEANUP_*` env vars.
 */
import { readdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { config } from '../config'
import { logger } from '../log'
import { pingDatabase } from '../db/client'
import { pruneBufferedRuns } from '../agui/run-event-buffer'

const DAY_MS = 86_400_000
const MINUTE_MS = 60_000

export type CleanupSummary = {
  runEventsDeleted: number
  archivedSessionsDeleted: number
  bufferedRunsPruned: number
  sandboxFilesDeleted: number
}

export type CleanupOptions = {
  runEventRetentionDays?: number
  archivedSessionRetentionDays?: number
  sandboxRetentionMinutes?: number
}

let lastRunAt: string | null = null
let lastSummary: CleanupSummary | null = null

/** Remove files/dirs under `dir` whose mtime is older than maxAgeMs. Missing dir is a no-op. */
export async function pruneSandboxFiles(dir: string, maxAgeMs: number): Promise<number> {
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch {
    return 0
  }
  const cutoff = Date.now() - maxAgeMs
  let deleted = 0
  for (const name of entries) {
    const full = join(dir, name)
    try {
      const info = await stat(full)
      if (info.mtimeMs < cutoff) {
        await rm(full, { recursive: true, force: true })
        deleted++
      }
    } catch {
      // ignore individual file errors — best-effort cleanup
    }
  }
  return deleted
}

export async function runCleanupOnce(opts: CleanupOptions = {}): Promise<CleanupSummary> {
  const runEventDays = opts.runEventRetentionDays ?? config.CLEANUP_RUN_EVENT_RETENTION_DAYS
  const sessionDays = opts.archivedSessionRetentionDays ?? config.CLEANUP_ARCHIVED_SESSION_RETENTION_DAYS
  const sandboxMinutes = opts.sandboxRetentionMinutes ?? config.CLEANUP_SANDBOX_RETENTION_MINUTES

  const summary: CleanupSummary = {
    runEventsDeleted: 0,
    archivedSessionsDeleted: 0,
    bufferedRunsPruned: 0,
    sandboxFilesDeleted: 0,
  }

  summary.bufferedRunsPruned = pruneBufferedRuns(runEventDays * DAY_MS)
  summary.sandboxFilesDeleted = await pruneSandboxFiles(
    join(config.HERMES_DATA_DIR, 'sandbox'),
    sandboxMinutes * MINUTE_MS,
  )

  if (await pingDatabase()) {
    const now = Date.now()
    const { runEventsRepo } = await import('../db/repositories/run_events')
    const { sessionsRepo } = await import('../db/repositories/sessions')
    summary.runEventsDeleted = await runEventsRepo.deleteOlderThan(
      new Date(now - runEventDays * DAY_MS),
    )
    summary.archivedSessionsDeleted = await sessionsRepo.deleteArchivedOlderThan(
      new Date(now - sessionDays * DAY_MS),
    )
  }

  lastRunAt = new Date().toISOString()
  lastSummary = summary
  logger.info('Cleanup sweep complete', { ...summary })
  return summary
}

let timer: ReturnType<typeof setInterval> | null = null
let running = false

export type CleanupWorkerHandle = { stop: () => void }

export function startCleanupWorker(options?: {
  intervalMs?: number
  immediate?: boolean
  runFn?: () => Promise<unknown>
}): CleanupWorkerHandle {
  const intervalMs = options?.intervalMs ?? config.CLEANUP_INTERVAL_MS
  const runFn = options?.runFn ?? (() => runCleanupOnce())
  const immediate = options?.immediate ?? true

  stopCleanupWorker()

  const tick = async (): Promise<void> => {
    if (running) return // skip overlapping sweeps
    running = true
    try {
      await runFn()
    } catch (err) {
      logger.error('Cleanup sweep failed', { error: String(err) })
    } finally {
      running = false
    }
  }

  timer = setInterval(() => void tick(), intervalMs)
  // Don't keep the process alive solely for the cleanup timer.
  ;(timer as { unref?: () => void }).unref?.()
  if (immediate) void tick()

  logger.info('Cleanup worker started', { intervalMs })
  return { stop: stopCleanupWorker }
}

export function stopCleanupWorker(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}

export function getCleanupStatus(): {
  scheduled: boolean
  lastRunAt: string | null
  lastSummary: CleanupSummary | null
} {
  return { scheduled: timer !== null, lastRunAt, lastSummary }
}
