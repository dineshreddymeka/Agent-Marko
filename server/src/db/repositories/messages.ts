import { and, desc, eq, lt, or, sql } from 'drizzle-orm'
import type { Message } from '@hermes/shared'
import { getDb } from '../client'
import { messages } from '../schema'

function toDto(row: typeof messages.$inferSelect): Message {
  return {
    id: row.id,
    sessionId: row.sessionId,
    runId: row.runId,
    role: row.role as Message['role'],
    content: row.content,
    toolName: row.toolName,
    toolArgs: (row.toolArgs as Record<string, unknown> | null) ?? null,
    toolResult: row.toolResult ?? null,
    thinking: row.thinking,
    a2ui: row.a2ui ?? null,
    tokens: row.tokens,
    createdAt: row.createdAt.toISOString(),
  }
}

export const messagesRepo = {
  async listBySession(
    sessionId: string,
    opts?: { limit?: number; before?: { createdAt: string; id: string } },
  ): Promise<Message[]> {
    const db = getDb()
    const limit = opts?.limit ?? 100
    let where = eq(messages.sessionId, sessionId)
    if (opts?.before) {
      where = and(
        eq(messages.sessionId, sessionId),
        or(
          lt(messages.createdAt, new Date(opts.before.createdAt)),
          and(
            eq(messages.createdAt, new Date(opts.before.createdAt)),
            lt(messages.id, opts.before.id),
          ),
        ),
      )!
    }
    const rows = await db
      .select()
      .from(messages)
      .where(where)
      .orderBy(desc(messages.createdAt), desc(messages.id))
      .limit(limit)
    return rows.reverse().map(toDto)
  },

  async getById(id: string): Promise<Message | null> {
    const db = getDb()
    const [row] = await db.select().from(messages).where(eq(messages.id, id)).limit(1)
    return row ? toDto(row) : null
  },

  async create(input: {
    sessionId: string
    runId?: string | null
    role: Message['role']
    content: string
    toolName?: string | null
    toolArgs?: Record<string, unknown> | null
    toolResult?: unknown
    thinking?: string | null
    a2ui?: unknown
    tokens?: number | null
  }): Promise<Message> {
    const db = getDb()
    const [row] = await db
      .insert(messages)
      .values({
        sessionId: input.sessionId,
        runId: input.runId ?? null,
        role: input.role,
        content: input.content,
        toolName: input.toolName ?? null,
        toolArgs: input.toolArgs ?? null,
        toolResult: input.toolResult ?? null,
        thinking: input.thinking ?? null,
        a2ui: input.a2ui ?? null,
        tokens: input.tokens ?? null,
      })
      .returning()
    if (!row) throw new Error('Failed to create message')
    return toDto(row)
  },

  async bulkCreate(items: Parameters<typeof messagesRepo.create>[0][]): Promise<Message[]> {
    if (items.length === 0) return []
    const db = getDb()
    const rows = await db
      .insert(messages)
      .values(
        items.map((input) => ({
          sessionId: input.sessionId,
          runId: input.runId ?? null,
          role: input.role,
          content: input.content,
          toolName: input.toolName ?? null,
          toolArgs: input.toolArgs ?? null,
          toolResult: input.toolResult ?? null,
          thinking: input.thinking ?? null,
          a2ui: input.a2ui ?? null,
          tokens: input.tokens ?? null,
        })),
      )
      .returning()
    return rows.map(toDto)
  },

  async ftsSearch(query: string, limit = 20): Promise<Message[]> {
    const db = getDb()
    const rows = await db.execute(sql`
      SELECT * FROM messages
      WHERE search @@ plainto_tsquery('english', ${query})
      ORDER BY ts_rank(search, plainto_tsquery('english', ${query})) DESC
      LIMIT ${limit}
    `)
    return (rows as unknown as (typeof messages.$inferSelect)[]).map(toDto)
  },

  async setEmbedding(id: string, embedding: number[]): Promise<void> {
    const db = getDb()
    const vec = `[${embedding.join(',')}]`
    await db.execute(sql`UPDATE messages SET embedding = ${vec}::vector WHERE id = ${id}`)
  },
}
