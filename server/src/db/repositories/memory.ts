import { desc, eq, sql } from 'drizzle-orm'
import type { MemoryEntry } from '@hermes/shared'
import { getDb } from '../client'
import { memory } from '../schema'

function toDto(row: typeof memory.$inferSelect): MemoryEntry {
  return {
    id: row.id,
    kind: row.kind as MemoryEntry['kind'],
    content: row.content,
    sourceSession: row.sourceSession,
    importance: row.importance,
    createdAt: row.createdAt.toISOString(),
    lastAccessed: row.lastAccessed?.toISOString() ?? null,
  }
}

export const memoryRepo = {
  async list(opts?: { kind?: MemoryEntry['kind']; limit?: number }): Promise<MemoryEntry[]> {
    const db = getDb()
    const limit = opts?.limit ?? 50
    const rows = opts?.kind
      ? await db
          .select()
          .from(memory)
          .where(eq(memory.kind, opts.kind))
          .orderBy(desc(memory.importance), desc(memory.createdAt))
          .limit(limit)
      : await db
          .select()
          .from(memory)
          .orderBy(desc(memory.importance), desc(memory.createdAt))
          .limit(limit)
    return rows.map(toDto)
  },

  async getById(id: string): Promise<MemoryEntry | null> {
    const db = getDb()
    const [row] = await db.select().from(memory).where(eq(memory.id, id)).limit(1)
    return row ? toDto(row) : null
  },

  async create(input: {
    kind: MemoryEntry['kind']
    content: string
    sourceSession?: string | null
    importance?: number
  }): Promise<MemoryEntry> {
    const db = getDb()
    const [row] = await db
      .insert(memory)
      .values({
        kind: input.kind,
        content: input.content,
        sourceSession: input.sourceSession ?? null,
        importance: input.importance ?? 0.5,
      })
      .returning()
    if (!row) throw new Error('Failed to create memory entry')
    return toDto(row)
  },

  async update(
    id: string,
    patch: Partial<{ kind: MemoryEntry['kind']; content: string; importance: number }>,
  ): Promise<MemoryEntry | null> {
    const db = getDb()
    const [row] = await db.update(memory).set(patch).where(eq(memory.id, id)).returning()
    return row ? toDto(row) : null
  },

  async delete(id: string): Promise<boolean> {
    const db = getDb()
    const result = await db.delete(memory).where(eq(memory.id, id)).returning({ id: memory.id })
    return result.length > 0
  },

  async touchAccess(id: string): Promise<void> {
    const db = getDb()
    await db.update(memory).set({ lastAccessed: new Date() }).where(eq(memory.id, id))
  },

  async setEmbedding(id: string, embedding: number[]): Promise<void> {
    const db = getDb()
    const vec = `[${embedding.join(',')}]`
    await db.execute(sql`UPDATE memory SET embedding = ${vec}::vector WHERE id = ${id}`)
  },

  async vectorSearch(embedding: number[], limit = 10): Promise<MemoryEntry[]> {
    const db = getDb()
    const vec = `[${embedding.join(',')}]`
    const rows = await db.execute(sql`
      SELECT *, (embedding <=> ${vec}::vector) AS distance
      FROM memory
      WHERE embedding IS NOT NULL
      ORDER BY distance ASC
      LIMIT ${limit}
    `)
    return (rows as unknown as (typeof memory.$inferSelect)[]).map(toDto)
  },
}
