import { eq } from 'drizzle-orm'
import type { McpServer } from '@hermes/shared'
import { getDb } from '../client'
import { mcpServers } from '../schema'

function toDto(row: typeof mcpServers.$inferSelect): McpServer {
  return {
    id: row.id,
    name: row.name,
    transport: row.transport as McpServer['transport'],
    command: row.command,
    url: row.url,
    env: (row.env as Record<string, string> | null) ?? null,
    headers: (row.headers as Record<string, string> | null) ?? null,
    enabled: row.enabled,
    toolWhitelist: (row.toolWhitelist as string[] | null) ?? null,
    createdAt: row.createdAt.toISOString(),
  }
}

export const mcpServersRepo = {
  async list(): Promise<McpServer[]> {
    const db = getDb()
    const rows = await db.select().from(mcpServers)
    return rows.map(toDto)
  },

  async getById(id: string): Promise<McpServer | null> {
    const db = getDb()
    const [row] = await db.select().from(mcpServers).where(eq(mcpServers.id, id)).limit(1)
    return row ? toDto(row) : null
  },

  async getEnabled(): Promise<McpServer[]> {
    const db = getDb()
    const rows = await db.select().from(mcpServers).where(eq(mcpServers.enabled, true))
    return rows.map(toDto)
  },

  async create(input: {
    name: string
    transport: McpServer['transport']
    command?: string | null
    url?: string | null
    env?: Record<string, string> | null
    headers?: Record<string, string> | null
    enabled?: boolean
    toolWhitelist?: string[] | null
  }): Promise<McpServer> {
    const db = getDb()
    const [row] = await db
      .insert(mcpServers)
      .values({
        name: input.name,
        transport: input.transport,
        command: input.command ?? null,
        url: input.url ?? null,
        env: input.env ?? null,
        headers: input.headers ?? null,
        enabled: input.enabled ?? true,
        toolWhitelist: input.toolWhitelist ?? null,
      })
      .returning()
    if (!row) throw new Error('Failed to create MCP server')
    return toDto(row)
  },

  async update(
    id: string,
    patch: Partial<{
      name: string
      transport: McpServer['transport']
      command: string | null
      url: string | null
      env: Record<string, string> | null
      headers: Record<string, string> | null
      enabled: boolean
      toolWhitelist: string[] | null
    }>,
  ): Promise<McpServer | null> {
    const db = getDb()
    const [row] = await db.update(mcpServers).set(patch).where(eq(mcpServers.id, id)).returning()
    return row ? toDto(row) : null
  },

  async delete(id: string): Promise<boolean> {
    const db = getDb()
    const result = await db
      .delete(mcpServers)
      .where(eq(mcpServers.id, id))
      .returning({ id: mcpServers.id })
    return result.length > 0
  },
}
