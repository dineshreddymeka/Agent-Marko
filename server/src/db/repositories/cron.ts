import { and, arrayContains, desc, eq } from 'drizzle-orm'
import { coerceCronWorkflow, type CronJob, type CronRun, type CronWorkflow } from '@hermes/shared'
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
    timezone: row.timezone ?? 'UTC',
    workflow: coerceCronWorkflow(row.workflow),
    mcpServerIds: row.mcpServerIds ?? [],
    skillIds: row.skillIds ?? [],
    updatedAt: row.updatedAt?.toISOString() ?? null,
  }
}

function runToDto(row: typeof cronRuns.$inferSelect): CronRun {
  return {
    id: row.id,
    jobId: row.jobId,
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
    status: row.status,
    sessionId: row.sessionId,
    error: row.error,
    detail: (row.detail as Record<string, unknown> | null) ?? null,
  }
}

export type CronJobFilter = {
  /** Only jobs whose mcp_server_ids array contains this id (uses GIN @>). */
  mcpServerId?: string
  /** Only jobs whose skill_ids array contains this id (uses GIN @>). */
  skillId?: string
}

export const cronRepo = {
  async listJobs(filter?: CronJobFilter): Promise<CronJob[]> {
    const db = getDb()
    const conditions = []
    if (filter?.mcpServerId) conditions.push(arrayContains(cronJobs.mcpServerIds, [filter.mcpServerId]))
    if (filter?.skillId) conditions.push(arrayContains(cronJobs.skillIds, [filter.skillId]))
    const query = db.select().from(cronJobs)
    const rows = conditions.length
      ? await query.where(and(...conditions)).orderBy(desc(cronJobs.name))
      : await query.orderBy(desc(cronJobs.name))
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
    timezone?: string
    workflow?: CronWorkflow
    mcpServerIds?: string[]
    skillIds?: string[]
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
        timezone: input.timezone ?? 'UTC',
        workflow: input.workflow ?? {},
        mcpServerIds: input.mcpServerIds ?? input.workflow?.mcpServerIds ?? [],
        skillIds: input.skillIds ?? input.workflow?.skillIds ?? [],
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
      timezone: string
      workflow: CronWorkflow
      mcpServerIds: string[]
      skillIds: string[]
    }>,
  ): Promise<CronJob | null> {
    const db = getDb()
    const values: Record<string, unknown> = { ...patch, updatedAt: new Date() }
    // Keep array columns in sync whenever the workflow JSONB changes.
    if (patch.workflow) {
      values.mcpServerIds = patch.mcpServerIds ?? patch.workflow.mcpServerIds
      values.skillIds = patch.skillIds ?? patch.workflow.skillIds
    }
    const [row] = await db
      .update(cronJobs)
      .set(values as Partial<typeof cronJobs.$inferInsert>)
      .where(eq(cronJobs.id, id))
      .returning()
    return row ? jobToDto(row) : null
  },

  async deleteJob(id: string): Promise<boolean> {
    const db = getDb()
    const result = await db.delete(cronJobs).where(eq(cronJobs.id, id)).returning({ id: cronJobs.id })
    return result.length > 0
  },

  /**
   * After an MCP server is deleted, strip its id from denormalized cron bindings
   * (`mcp_server_ids` + `workflow.mcpServerIds`) so typed arrays and JSON stay in sync.
   */
  async removeDeletedMcpServerBinding(serverId: string): Promise<void> {
    const affected = await cronRepo.listJobs({ mcpServerId: serverId })
    for (const job of affected) {
      const mcpServerIds = job.mcpServerIds.filter((id) => id !== serverId)
      const workflow: CronWorkflow = {
        ...job.workflow,
        mcpServerIds: (job.workflow.mcpServerIds ?? []).filter((id) => id !== serverId),
      }
      await cronRepo.updateJob(job.id, { mcpServerIds, workflow })
    }
  },

  /**
   * After a skill is deleted, strip its id from denormalized cron bindings
   * (`skill_ids` + `workflow.skillIds`) so typed arrays and JSON stay in sync.
   */
  async removeDeletedSkillBinding(skillId: string): Promise<void> {
    const affected = await cronRepo.listJobs({ skillId })
    for (const job of affected) {
      const skillIds = job.skillIds.filter((id) => id !== skillId)
      const workflow: CronWorkflow = {
        ...job.workflow,
        skillIds: (job.workflow.skillIds ?? []).filter((id) => id !== skillId),
      }
      await cronRepo.updateJob(job.id, { skillIds, workflow })
    }
  },

  async listRuns(jobId: string, limit = 20): Promise<CronRun[]> {
    const db = getDb()
    const rows = await db
      .select()
      .from(cronRuns)
      .where(eq(cronRuns.jobId, jobId))
      .orderBy(desc(cronRuns.startedAt))
      .limit(limit)
    return rows.map(runToDto)
  },

  async createRun(jobId: string, sessionId?: string | null, detail?: Record<string, unknown>) {
    const db = getDb()
    const [row] = await db
      .insert(cronRuns)
      .values({ jobId, sessionId: sessionId ?? null, status: 'running', detail: detail ?? null })
      .returning()
    return row
  },

  async finishRun(id: string, status: string, error?: string | null, detail?: Record<string, unknown>) {
    const db = getDb()
    const patch: Partial<typeof cronRuns.$inferInsert> = {
      status,
      error: error ?? null,
      finishedAt: new Date(),
    }
    if (detail !== undefined) patch.detail = detail
    await db.update(cronRuns).set(patch).where(eq(cronRuns.id, id))
  },
}
