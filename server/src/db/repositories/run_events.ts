import { asc, eq } from 'drizzle-orm'
import { getDb } from '../client'
import { runEvents } from '../schema'

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
  return {
    id: row.id,
    runId: row.runId,
    sessionId: row.sessionId,
    seq: row.seq,
    eventType: row.eventType,
    payload: row.payload,
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
  }): Promise<void> {
    const db = getDb()
    await db.insert(runEvents).values({
      runId: input.runId,
      sessionId: input.sessionId ?? null,
      seq: input.seq,
      eventType: input.eventType,
      payload: input.payload,
    })
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
}
