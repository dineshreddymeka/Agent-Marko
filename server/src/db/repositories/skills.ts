import { desc, eq, ilike, or, sql } from 'drizzle-orm'
import type { Skill } from '@hermes/shared'
import { getDb } from '../client'
import { skills } from '../schema'

function toDto(row: typeof skills.$inferSelect): Skill {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    bodyMd: row.bodyMd,
    source: row.source,
    path: row.path,
    usageCount: row.usageCount,
    successCount: row.successCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export const skillsRepo = {
  async list(limit = 100): Promise<Skill[]> {
    const db = getDb()
    const rows = await db.select().from(skills).orderBy(desc(skills.updatedAt)).limit(limit)
    return rows.map(toDto)
  },

  async getById(id: string): Promise<Skill | null> {
    const db = getDb()
    const [row] = await db.select().from(skills).where(eq(skills.id, id)).limit(1)
    return row ? toDto(row) : null
  },

  async getByName(name: string): Promise<Skill | null> {
    const db = getDb()
    const [row] = await db.select().from(skills).where(eq(skills.name, name)).limit(1)
    return row ? toDto(row) : null
  },

  async upsert(input: {
    name: string
    description?: string | null
    bodyMd: string
    source: string
    path?: string | null
    triggers?: unknown
  }): Promise<Skill> {
    const db = getDb()
    const existing = await skillsRepo.getByName(input.name)
    if (existing) {
      const [row] = await db
        .update(skills)
        .set({
          description: input.description ?? null,
          bodyMd: input.bodyMd,
          source: input.source,
          path: input.path ?? null,
          triggers: input.triggers ?? null,
          updatedAt: new Date(),
        })
        .where(eq(skills.name, input.name))
        .returning()
      if (!row) throw new Error('Failed to update skill')
      return toDto(row)
    }
    const [row] = await db
      .insert(skills)
      .values({
        name: input.name,
        description: input.description ?? null,
        bodyMd: input.bodyMd,
        source: input.source,
        path: input.path ?? null,
        triggers: input.triggers ?? null,
      })
      .returning()
    if (!row) throw new Error('Failed to create skill')
    return toDto(row)
  },

  async delete(id: string): Promise<boolean> {
    const db = getDb()
    const result = await db.delete(skills).where(eq(skills.id, id)).returning({ id: skills.id })
    return result.length > 0
  },

  async incrementUsage(id: string, success = false): Promise<void> {
    const db = getDb()
    if (success) {
      await db.execute(sql`
        UPDATE skills SET usage_count = usage_count + 1, success_count = success_count + 1, updated_at = NOW()
        WHERE id = ${id}
      `)
    } else {
      await db.execute(sql`
        UPDATE skills SET usage_count = usage_count + 1, updated_at = NOW() WHERE id = ${id}
      `)
    }
  },

  async search(query: string, limit = 20): Promise<Skill[]> {
    const db = getDb()
    const rows = await db
      .select()
      .from(skills)
      .where(or(ilike(skills.name, `%${query}%`), ilike(skills.description, `%${query}%`)))
      .limit(limit)
    return rows.map(toDto)
  },

  async setEmbedding(id: string, embedding: number[]): Promise<void> {
    const db = getDb()
    const vec = `[${embedding.join(',')}]`
    await db.execute(sql`UPDATE skills SET embedding = ${vec}::vector WHERE id = ${id}`)
  },

  async vectorSearch(embedding: number[], limit = 5): Promise<Skill[]> {
    const db = getDb()
    const vec = `[${embedding.join(',')}]`
    const rows = await db.execute(sql`
      SELECT *, (embedding <=> ${vec}::vector) AS distance
      FROM skills
      WHERE embedding IS NOT NULL
      ORDER BY distance ASC
      LIMIT ${limit}
    `)
    return (rows as unknown as (typeof skills.$inferSelect)[]).map(toDto)
  },
}
