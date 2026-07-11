import { desc, eq } from 'drizzle-orm'
import type { CronJob } from '@hermes/shared'
import { getDb } from '../client'
import { cronJobs, cronRuns } from '../schema'

function jobToDto(row: typeof cronJobs.$inferSelect): CronJob {
  return {
    id: row.id,
    name: row.name,
    schedule: row.schedule,
    prompt: row.prompt,
    profileId: row.profileId,
    enabled: row.enabled,
    lastRun: row.lastRun?.toISOString() ?? null,
    nextRun: row.nextRun?.toISOString() ?? null,
  }
}

export const cronRepo = {
  async listJobs(): Promise<CronJob[]> {
    const db = getDb()
    const rows = await db.select().from(cronJobs).orderBy(desc(cronJobs.name))
    return rows.map(jobToDto)
  },

  async getJob(id: string): Promise<CronJob | null> {
    const db = getDb()
    const [row] = await db.select().from(cronJobs).where(eq(cronJobs.id, id)).limit(1)
    return row ? jobToDto(row) : null
  },

  async createJob(input: {
    name: string
    schedule: string
    prompt: string
    profileId?: string | null
    enabled?: boolean
    nextRun?: Date | null
  }): Promise<CronJob> {
    const db = getDb()
    const [row] = await db
      .insert(cronJobs)
      .values({
        name: input.name,
        schedule: input.schedule,
        prompt: input.prompt,
        profileId: input.profileId ?? null,
        enabled: input.enabled ?? true,
        nextRun: input.nextRun ?? null,
      })
      .returning()
    if (!row) throw new Error('Failed to create cron job')
    return jobToDto(row)
  },

  async updateJob(
    id: string,
    patch: Partial<{
      name: string
      schedule: string
      prompt: string
      profileId: string | null
      enabled: boolean
      lastRun: Date | null
      nextRun: Date | null
    }>,
  ): Promise<CronJob | null> {
    const db = getDb()
    const [row] = await db.update(cronJobs).set(patch).where(eq(cronJobs.id, id)).returning()
    return row ? jobToDto(row) : null
  },

  async deleteJob(id: string): Promise<boolean> {
    const db = getDb()
    const result = await db.delete(cronJobs).where(eq(cronJobs.id, id)).returning({ id: cronJobs.id })
    return result.length > 0
  },

  async listRuns(jobId: string, limit = 20) {
    const db = getDb()
    return db
      .select()
      .from(cronRuns)
      .where(eq(cronRuns.jobId, jobId))
      .orderBy(desc(cronRuns.startedAt))
      .limit(limit)
  },

  async createRun(jobId: string, sessionId?: string | null) {
    const db = getDb()
    const [row] = await db
      .insert(cronRuns)
      .values({ jobId, sessionId: sessionId ?? null, status: 'running' })
      .returning()
    return row
  },

  async finishRun(id: string, status: string, error?: string | null) {
    const db = getDb()
    await db
      .update(cronRuns)
      .set({ status, error: error ?? null, finishedAt: new Date() })
      .where(eq(cronRuns.id, id))
  },
}
