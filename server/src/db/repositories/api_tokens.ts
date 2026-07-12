import { createHash, randomBytes } from 'node:crypto'
import { eq } from 'drizzle-orm'
import type { ApiToken } from '@hermes/shared'
import { getDb } from '../client'
import { apiTokens } from '../schema'

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

function toDto(row: typeof apiTokens.$inferSelect, rawToken?: string): ApiToken {
  return {
    id: row.id,
    name: row.name,
    token: rawToken,
    scopes: Array.isArray(row.scopes) ? (row.scopes as string[]) : [],
    lastUsedAt: row.lastUsed?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  }
}

export const apiTokensRepo = {
  async list(): Promise<ApiToken[]> {
    const db = getDb()
    const rows = await db.select().from(apiTokens)
    return rows.map((r) => toDto(r))
  },

  async create(input: { name: string; scopes?: string[]; userId?: string | null }): Promise<ApiToken> {
    const raw = `hrm_${randomBytes(24).toString('hex')}`
    const db = getDb()
    const [row] = await db
      .insert(apiTokens)
      .values({
        name: input.name,
        userId: input.userId ?? null,
        tokenHash: hashToken(raw),
        tokenPrefix: raw.slice(0, 12),
        scopes: input.scopes ?? ['*'],
      })
      .returning()
    if (!row) throw new Error('Failed to create API token')
    return toDto(row, raw)
  },

  async delete(id: string): Promise<boolean> {
    const db = getDb()
    const result = await db.delete(apiTokens).where(eq(apiTokens.id, id)).returning({ id: apiTokens.id })
    return result.length > 0
  },

  async verify(rawToken: string): Promise<ApiToken | null> {
    if (!rawToken.startsWith('hrm_')) return null
    const db = getDb()
    const hash = hashToken(rawToken)
    const [row] = await db.select().from(apiTokens).where(eq(apiTokens.tokenHash, hash)).limit(1)
    if (!row) return null
    await db
      .update(apiTokens)
      .set({ lastUsed: new Date() })
      .where(eq(apiTokens.id, row.id))
      .catch(() => undefined)
    return toDto(row)
  },
}
