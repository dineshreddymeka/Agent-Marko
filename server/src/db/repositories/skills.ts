import { and, desc, eq, ilike, or, sql } from 'drizzle-orm'
import type { Skill } from '@hermes/shared'
import { getDb } from '../client'
import { skills } from '../schema'
import { cronRepo } from './cron'
import { skillContentHash, skillSlug } from '../../skills/sync-helpers'

function toDto(row: typeof skills.$inferSelect): Skill {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description ?? '',
    bodyMd: row.bodyMd,
    source: row.source as Skill['source'],
    path: row.path,
    contentHash: row.contentHash,
    triggers: (row.triggers as string[] | null) ?? null,
    enabled: row.enabled,
    lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
    missingOnDisk: row.missingOnDisk,
    usageCount: row.usageCount,
    successCount: row.successCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export type SkillUpsertInput = {
  name: string
  slug?: string
  description?: string | null
  bodyMd: string
  source: string
  path?: string | null
  contentHash?: string | null
  triggers?: unknown
  enabled?: boolean
  lastSyncedAt?: Date | null
  missingOnDisk?: boolean
  metadata?: unknown
  /** When true, skip updating body if content_hash matches (caller still updates sync stamps). */
  skipUnchangedBody?: boolean
}

export const skillsRepo = {
  async list(limit = 500): Promise<Skill[]> {
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

  async getBySlug(slug: string): Promise<Skill | null> {
    const db = getDb()
    const [row] = await db.select().from(skills).where(eq(skills.slug, slug)).limit(1)
    return row ? toDto(row) : null
  },

  async getByPath(path: string): Promise<Skill | null> {
    const db = getDb()
    const [row] = await db.select().from(skills).where(eq(skills.path, path)).limit(1)
    return row ? toDto(row) : null
  },

  /**
   * Upsert by path → slug → name (stable sync identity).
   * Returns `{ skill, created, contentChanged }` so callers can queue embeddings only when needed.
   */
  async upsert(input: SkillUpsertInput): Promise<{
    skill: Skill
    created: boolean
    contentChanged: boolean
  }> {
    const db = getDb()
    const slug = input.slug?.trim() || skillSlug(input.name)
    const hash = input.contentHash ?? skillContentHash(input.bodyMd)
    const now = new Date()

    let existing: Skill | null = null
    if (input.path) existing = await skillsRepo.getByPath(input.path)
    if (!existing) existing = await skillsRepo.getBySlug(slug)
    if (!existing) existing = await skillsRepo.getByName(input.name)

    if (existing) {
      const contentChanged = existing.contentHash !== hash
      if (input.skipUnchangedBody && !contentChanged) {
        const [row] = await db
          .update(skills)
          .set({
            source: input.source,
            path: input.path !== undefined ? input.path : existing.path,
            lastSyncedAt: input.lastSyncedAt ?? now,
            missingOnDisk: input.missingOnDisk ?? false,
            enabled: input.enabled ?? existing.enabled,
            updatedAt: now,
          })
          .where(eq(skills.id, existing.id))
          .returning()
        if (!row) throw new Error('Failed to touch skill')
        return { skill: toDto(row), created: false, contentChanged: false }
      }

      const [row] = await db
        .update(skills)
        .set({
          name: input.name,
          slug,
          description: input.description ?? null,
          bodyMd: input.bodyMd,
          source: input.source,
          path: input.path !== undefined ? input.path : existing.path,
          contentHash: hash,
          triggers: input.triggers ?? null,
          enabled: input.enabled ?? existing.enabled,
          lastSyncedAt: input.lastSyncedAt ?? now,
          missingOnDisk: input.missingOnDisk ?? false,
          metadata: input.metadata !== undefined ? input.metadata : undefined,
          updatedAt: now,
        })
        .where(eq(skills.id, existing.id))
        .returning()
      if (!row) throw new Error('Failed to update skill')
      return { skill: toDto(row), created: false, contentChanged }
    }

    const [row] = await db
      .insert(skills)
      .values({
        name: input.name,
        slug,
        description: input.description ?? null,
        bodyMd: input.bodyMd,
        source: input.source,
        path: input.path ?? null,
        contentHash: hash,
        triggers: input.triggers ?? null,
        enabled: input.enabled ?? true,
        lastSyncedAt: input.lastSyncedAt ?? now,
        missingOnDisk: input.missingOnDisk ?? false,
        metadata: input.metadata ?? null,
      })
      .returning()
    if (!row) throw new Error('Failed to create skill')
    return { skill: toDto(row), created: true, contentChanged: true }
  },

  async update(
    id: string,
    patch: Partial<{
      name: string
      slug: string
      description: string | null
      bodyMd: string
      source: string
      path: string | null
      contentHash: string | null
      triggers: unknown
      enabled: boolean
      lastSyncedAt: Date | null
      missingOnDisk: boolean
      metadata: unknown
    }>,
  ): Promise<Skill | null> {
    const db = getDb()
    const next = { ...patch, updatedAt: new Date() } as Record<string, unknown>
    if (patch.bodyMd !== undefined && patch.contentHash === undefined) {
      next.contentHash = skillContentHash(patch.bodyMd)
    }
    if (patch.name !== undefined && patch.slug === undefined) {
      next.slug = skillSlug(patch.name)
    }
    const [row] = await db.update(skills).set(next).where(eq(skills.id, id)).returning()
    return row ? toDto(row) : null
  },

  async markMissing(ids: string[]): Promise<number> {
    if (!ids.length) return 0
    const db = getDb()
    let n = 0
    for (const id of ids) {
      const [row] = await db
        .update(skills)
        .set({ missingOnDisk: true, updatedAt: new Date() })
        .where(and(eq(skills.id, id), eq(skills.missingOnDisk, false)))
        .returning({ id: skills.id })
      if (row) n++
    }
    return n
  },

  async listWithPaths(): Promise<Skill[]> {
    const db = getDb()
    const rows = await db
      .select()
      .from(skills)
      .where(sql`${skills.path} IS NOT NULL`)
    return rows.map(toDto)
  },

  async delete(id: string): Promise<boolean> {
    const db = getDb()
    const result = await db.delete(skills).where(eq(skills.id, id)).returning({ id: skills.id })
    const deleted = result.length > 0
    if (deleted) {
      await cronRepo.removeDeletedSkillBinding(id)
    }
    return deleted
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
    const q = query.trim()
    if (!q) return []

    // Prefer FTS when available; fall back to ILIKE.
    try {
      const rows = await db.execute(sql`
        SELECT * FROM skills
        WHERE enabled = TRUE
          AND search @@ plainto_tsquery('english', ${q})
        ORDER BY ts_rank(search, plainto_tsquery('english', ${q})) DESC
        LIMIT ${limit}
      `)
      const list = rows as unknown as (typeof skills.$inferSelect)[]
      if (list.length) return list.map(toDto)
    } catch {
      // Column may be missing mid-migration; fall through.
    }

    const rows = await db
      .select()
      .from(skills)
      .where(
        and(
          eq(skills.enabled, true),
          or(ilike(skills.name, `%${q}%`), ilike(skills.description, `%${q}%`)),
        ),
      )
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
        AND enabled = TRUE
      ORDER BY distance ASC
      LIMIT ${limit}
    `)
    return (rows as unknown as (typeof skills.$inferSelect)[]).map(toDto)
  },

  async counts(): Promise<{ total: number; enabled: number; missing: number }> {
    const db = getDb()
    const rows = await db.execute(sql`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE enabled)::int AS enabled,
        COUNT(*) FILTER (WHERE missing_on_disk)::int AS missing
      FROM skills
    `)
    const row = (rows as unknown as Array<{ total: number; enabled: number; missing: number }>)[0]
    return {
      total: Number(row?.total ?? 0),
      enabled: Number(row?.enabled ?? 0),
      missing: Number(row?.missing ?? 0),
    }
  },
}
