import { eq, sql } from 'drizzle-orm'
import { getDb } from '../client'
import { nowTimestamp } from '../insert-contract'
import { settings } from '../schema'

export const settingsRepo = {
  async get(key: string): Promise<unknown | null> {
    const db = getDb()
    const [row] = await db.select().from(settings).where(eq(settings.key, key)).limit(1)
    return row?.value ?? null
  },

  async getAll(): Promise<Record<string, unknown>> {
    const db = getDb()
    const rows = await db.select().from(settings)
    return Object.fromEntries(rows.map((r) => [r.key, r.value]))
  },

  async set(key: string, value: unknown, opts?: { sessionId?: string | null }): Promise<void> {
    const db = getDb()
    const now = nowTimestamp()
    // Cast via text → jsonb so primitives (boolean/number/string) bind correctly under Bun.sql.
    const jsonValue = sql`${JSON.stringify(value)}::jsonb`
    await db
      .insert(settings)
      .values({
        key,
        value: jsonValue,
        sessionId: opts?.sessionId ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: settings.key,
        set: {
          value: jsonValue,
          updatedAt: now,
          ...(opts?.sessionId !== undefined ? { sessionId: opts.sessionId } : {}),
        },
      })
  },

  async delete(key: string): Promise<boolean> {
    const db = getDb()
    const result = await db.delete(settings).where(eq(settings.key, key)).returning({ key: settings.key })
    return result.length > 0
  },
}
