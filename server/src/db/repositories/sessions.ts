import { desc, eq, and, ilike, lt, sql } from 'drizzle-orm'
import type { Session } from '@hermes/shared'
import { getDb } from '../client'
import { sessions } from '../schema'

function toDto(row: typeof sessions.$inferSelect): Session {
  return {
    id: row.id,
    title: row.title,
    groupName: row.groupName,
    profileId: row.profileId,
    pinned: row.pinned,
    archived: row.archived,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export const sessionsRepo = {
  async list(opts?: { archived?: boolean; limit?: number; offset?: number }): Promise<Session[]> {
    const db = getDb()
    const limit = opts?.limit ?? 50
    const offset = opts?.offset ?? 0
    const conditions = []
    if (opts?.archived !== undefined) {
      conditions.push(eq(sessions.archived, opts.archived))
    }
    const rows = await db
      .select()
      .from(sessions)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(sessions.pinned), desc(sessions.updatedAt))
      .limit(limit)
      .offset(offset)
    return rows.map(toDto)
  },

  async getById(id: string): Promise<Session | null> {
    const db = getDb()
    const [row] = await db.select().from(sessions).where(eq(sessions.id, id)).limit(1)
    return row ? toDto(row) : null
  },

  async create(input: {
    id?: string
    title?: string
    groupName?: string | null
    profileId?: string | null
  }): Promise<Session> {
    const db = getDb()
    const [row] = await db
      .insert(sessions)
      .values({
        ...(input.id ? { id: input.id } : {}),
        title: input.title ?? 'New chat',
        groupName: input.groupName ?? null,
        profileId: input.profileId ?? null,
      })
      .returning()
    if (!row) throw new Error('Failed to create session')
    return toDto(row)
  },

  /** Ensure a session row exists for threadId (AG-UI runs use session UUID as threadId). */
  async ensure(id: string, title = 'New chat'): Promise<Session> {
    const existing = await this.getById(id)
    if (existing) return existing
    return this.create({ id, title })
  },

  async update(
    id: string,
    patch: Partial<{
      title: string
      groupName: string | null
      profileId: string | null
      pinned: boolean
      archived: boolean
    }>,
  ): Promise<Session | null> {
    const db = getDb()
    const [row] = await db
      .update(sessions)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(sessions.id, id))
      .returning()
    return row ? toDto(row) : null
  },

  async delete(id: string): Promise<boolean> {
    const db = getDb()
    const result = await db.delete(sessions).where(eq(sessions.id, id)).returning({ id: sessions.id })
    return result.length > 0
  },

  async deleteArchivedOlderThan(cutoff: Date): Promise<number> {
    const db = getDb()
    const rows = await db
      .delete(sessions)
      .where(and(eq(sessions.archived, true), lt(sessions.updatedAt, cutoff)))
      .returning({ id: sessions.id })
    return rows.length
  },

  async search(query: string, limit = 20): Promise<Session[]> {
    const db = getDb()
    const rows = await db
      .select()
      .from(sessions)
      .where(ilike(sessions.title, `%${query}%`))
      .orderBy(desc(sessions.updatedAt))
      .limit(limit)
    return rows.map(toDto)
  },

  async touch(id: string): Promise<void> {
    const db = getDb()
    await db.update(sessions).set({ updatedAt: new Date() }).where(eq(sessions.id, id))
  },

  async groups(): Promise<{ groupName: string | null; count: number }[]> {
    const db = getDb()
    const rows = await db
      .select({
        groupName: sessions.groupName,
        count: sql<number>`count(*)::int`,
      })
      .from(sessions)
      .groupBy(sessions.groupName)
    return rows
  },
}
