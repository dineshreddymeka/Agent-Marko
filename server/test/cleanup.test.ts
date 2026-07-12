import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, writeFile, utimes, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  pruneSandboxFiles,
  runCleanupOnce,
  startCleanupWorker,
  stopCleanupWorker,
  getCleanupStatus,
} from '../src/cleanup/worker'
import {
  bufferRunEvent,
  bufferedRunCount,
  getBufferedRunEvents,
  listBufferedRuns,
  pruneBufferedRuns,
} from '../src/agui/run-event-buffer'
import { isIntegrationEnabled, prepareIntegrationDb, truncateAppTables } from './helpers/db'

const enabled = await isIntegrationEnabled()

describe('cleanup: in-memory run buffer', () => {
  test('pruneBufferedRuns drops runs older than the retention window', () => {
    const oldRun = `old-${crypto.randomUUID()}`
    const freshRun = `fresh-${crypto.randomUUID()}`
    bufferRunEvent({ runId: oldRun, sessionId: null, seq: 0, eventType: 'RUN_STARTED', payload: {} as never })
    bufferRunEvent({ runId: freshRun, sessionId: null, seq: 0, eventType: 'RUN_STARTED', payload: {} as never })

    // Force the old run's last event timestamp into the past.
    const events = getBufferedRunEvents(oldRun)
    events[events.length - 1]!.createdAt = new Date(Date.now() - 10_000).toISOString()

    const removed = pruneBufferedRuns(5_000)
    expect(removed).toBeGreaterThanOrEqual(1)

    const remaining = listBufferedRuns(100)
    expect(remaining.some((r) => r.runId === oldRun)).toBe(false)
    expect(remaining.some((r) => r.runId === freshRun)).toBe(true)
    expect(bufferedRunCount()).toBeGreaterThanOrEqual(0)
  })
})

describe('cleanup: sandbox temp files', () => {
  test('pruneSandboxFiles deletes stale files and keeps recent ones', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hermes-sandbox-'))
    const stale = join(dir, 'stale.ts')
    const fresh = join(dir, 'fresh.ts')
    await writeFile(stale, 'old', 'utf8')
    await writeFile(fresh, 'new', 'utf8')
    const past = new Date(Date.now() - 60 * 60_000) // 60 minutes ago
    await utimes(stale, past, past)

    const deleted = await pruneSandboxFiles(dir, 30 * 60_000) // 30-minute window
    expect(deleted).toBe(1)

    const left = await readdir(dir)
    expect(left).toContain('fresh.ts')
    expect(left).not.toContain('stale.ts')
  })

  test('pruneSandboxFiles is a no-op for a missing directory', async () => {
    const deleted = await pruneSandboxFiles(join(tmpdir(), `does-not-exist-${crypto.randomUUID()}`), 1000)
    expect(deleted).toBe(0)
  })
})

describe('cleanup: worker scheduling', () => {
  afterEach(() => stopCleanupWorker())

  test('runs immediately and on the interval, then stops', async () => {
    let calls = 0
    const handle = startCleanupWorker({
      intervalMs: 20,
      immediate: true,
      runFn: async () => {
        calls++
      },
    })
    expect(getCleanupStatus().scheduled).toBe(true)

    await Bun.sleep(90)
    expect(calls).toBeGreaterThanOrEqual(2) // immediate + at least one interval tick

    handle.stop()
    expect(getCleanupStatus().scheduled).toBe(false)
    const afterStop = calls
    await Bun.sleep(60)
    expect(calls).toBe(afterStop) // no further ticks after stop
  })
})

describe.skipIf(!enabled)('cleanup: Postgres pruning (integration)', () => {
  afterEach(async () => {
    await truncateAppTables()
  })

  test('runCleanupOnce deletes old run_events and old archived sessions', async () => {
    await prepareIntegrationDb()
    const { getSql } = await import('../src/db/client')
    const { sessionsRepo } = await import('../src/db/repositories/sessions')
    const { runEventsRepo } = await import('../src/db/repositories/run_events')
    const sql = getSql()

    // Old archived session (updated 40 days ago) — should be deleted (retention 30d).
    const [oldArchived] = await sql`
      INSERT INTO sessions (title, archived, updated_at)
      VALUES ('old archived', true, now() - interval '40 days')
      RETURNING id
    `
    // Recent archived session — should be kept.
    const [recentArchived] = await sql`
      INSERT INTO sessions (title, archived, updated_at)
      VALUES ('recent archived', true, now() - interval '1 day')
      RETURNING id
    `
    // Active (non-archived) old session — should be kept.
    const [activeOld] = await sql`
      INSERT INTO sessions (title, archived, updated_at)
      VALUES ('active old', false, now() - interval '40 days')
      RETURNING id
    `

    // Old + recent run_events (retention 7d).
    await sql`
      INSERT INTO run_events (run_id, seq, event_type, payload, created_at)
      VALUES (gen_random_uuid(), 0, 'RUN_STARTED', '{}'::jsonb, now() - interval '10 days')
    `
    await sql`
      INSERT INTO run_events (run_id, seq, event_type, payload, created_at)
      VALUES (gen_random_uuid(), 0, 'RUN_STARTED', '{}'::jsonb, now() - interval '1 day')
    `

    const summary = await runCleanupOnce()
    expect(summary.runEventsDeleted).toBe(1)
    expect(summary.archivedSessionsDeleted).toBe(1)

    expect(await sessionsRepo.getById(oldArchived!.id as string)).toBeNull()
    expect(await sessionsRepo.getById(recentArchived!.id as string)).not.toBeNull()
    expect(await sessionsRepo.getById(activeOld!.id as string)).not.toBeNull()

    const remainingEvents = await runEventsRepo.listRecentRuns(100)
    expect(remainingEvents.length).toBe(1)
  })
})
