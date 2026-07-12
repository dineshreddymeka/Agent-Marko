import { asc, desc, eq, lt, sql } from 'drizzle-orm'
import { getDb } from '../client'
import { runEvents } from '../schema'

function retentionCutoff(days: number): Date {
  if (!Number.isFinite(days) || days < 1) {
    throw new Error(`pruneOlderThan: days must be >= 1 (got ${days})`)
  }
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000)
}

export type RunEventRecord = {
  id: string
  runId: string
  sessionId: string | null
  seq: number
  eventType: string
  payload: unknown
  createdAt: string
}

function toDto(row: typeof runEvents.$inferSelect): RunEventRecord {
  let payload: unknown = row.payload
  // Legacy double-encoded jsonb (drizzle+bun) may still surface as a string.
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload)
    } catch {
      /* keep string */
    }
  }
  return {
    id: row.id,
    runId: row.runId,
    sessionId: row.sessionId,
    seq: row.seq,
    eventType: row.eventType,
    payload,
    createdAt: row.createdAt.toISOString(),
  }
}

export const runEventsRepo = {
  async append(input: {
    runId: string
    sessionId?: string | null
    seq: number
    eventType: string
    payload: unknown
  }): Promise<RunEventRecord> {
    const db = getDb()
    const [row] = await db
      .insert(runEvents)
      .values({
        runId: input.runId,
        sessionId: input.sessionId ?? null,
        seq: input.seq,
        eventType: input.eventType,
        payload: input.payload,
      })
      .returning()
    if (!row) throw new Error('Failed to append run_event')
    const dto = toDto(row)
    void import('../../indexer/service')
      .then(({ queueRunEventIndex }) =>
        queueRunEventIndex({
          id: dto.id,
          eventType: dto.eventType,
          sessionId: dto.sessionId,
          runId: dto.runId,
        }),
      )
      .catch((err) => {
        void import('../../log').then(({ logger }) =>
          logger.warn('Failed to queue run_event index', { id: dto.id, error: String(err) }),
        )
      })
    return dto
  },

  async getById(id: string): Promise<RunEventRecord | null> {
    const db = getDb()
    const [row] = await db.select().from(runEvents).where(eq(runEvents.id, id)).limit(1)
    return row ? toDto(row) : null
  },

  async listByRun(runId: string): Promise<RunEventRecord[]> {
    const db = getDb()
    const rows = await db
      .select()
      .from(runEvents)
      .where(eq(runEvents.runId, runId))
      .orderBy(asc(runEvents.seq))
    return rows.map(toDto)
  },

  async listBySession(sessionId: string): Promise<RunEventRecord[]> {
    const db = getDb()
    const rows = await db
      .select()
      .from(runEvents)
      .where(eq(runEvents.sessionId, sessionId))
      .orderBy(asc(runEvents.seq))
    return rows.map(toDto)
  },

  async listRecentRuns(limit = 20): Promise<
    { runId: string; sessionId: string | null; eventCount: number; lastAt: string }[]
  > {
    const db = getDb()
    const rows = await db
      .select({
        runId: runEvents.runId,
        sessionId: runEvents.sessionId,
        eventCount: sql<number>`count(*)::int`,
        lastAt: sql<Date>`max(${runEvents.createdAt})`,
      })
      .from(runEvents)
      .groupBy(runEvents.runId, runEvents.sessionId)
      .orderBy(desc(sql`max(${runEvents.createdAt})`))
      .limit(limit)
    return rows.map((r) => ({
      runId: r.runId,
      sessionId: r.sessionId,
      eventCount: r.eventCount,
      lastAt: r.lastAt.toISOString(),
    }))
  },

  /** Delete `run_events` older than `days` (based on `created_at`). Returns deleted row count. */
  async pruneOlderThan(days: number): Promise<number> {
    const cutoff = retentionCutoff(days)
    return this.deleteOlderThan(cutoff)
  },

  async deleteOlderThan(cutoff: Date): Promise<number> {
    const ids = await this.deleteOlderThanReturning(cutoff)
    return ids.length
  },

  async deleteOlderThanReturning(cutoff: Date): Promise<string[]> {
    const db = getDb()
    const rows = await db
      .delete(runEvents)
      .where(lt(runEvents.createdAt, cutoff))
      .returning({ id: runEvents.id })
    return rows.map((row) => row.id)
  },
}
