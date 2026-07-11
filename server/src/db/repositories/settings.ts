import { eq } from 'drizzle-orm'
import { getDb } from '../client'
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

  async set(key: string, value: unknown): Promise<void> {
    const db = getDb()
    await db
      .insert(settings)
      .values({ key, value })
      .onConflictDoUpdate({ target: settings.key, set: { value } })
  },

  async delete(key: string): Promise<boolean> {
    const db = getDb()
    const result = await db.delete(settings).where(eq(settings.key, key)).returning({ key: settings.key })
    return result.length > 0
  },
}
