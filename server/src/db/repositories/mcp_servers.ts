/**
 * Open Jarvis — MCP servers + connection event storage.
 * Author: Dinesh Reddy Meka
 */
import { desc, eq, lt } from 'drizzle-orm'
import type {
  McpConnectionEvent,
  McpDiscoveredPrompt,
  McpDiscoveredResource,
  McpDiscoveredTool,
  McpServer,
} from '@hermes/shared'
import { getDb } from '../client'
import { mcpConnectionEvents, mcpServers } from '../schema'
import { cronRepo } from './cron'

function toDto(row: typeof mcpServers.$inferSelect): McpServer {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? null,
    transport: row.transport as McpServer['transport'],
    command: row.command,
    url: row.url,
    env: (row.env as Record<string, string> | null) ?? null,
    headers: (row.headers as Record<string, string> | null) ?? null,
    enabled: row.enabled,
    toolWhitelist: (row.toolWhitelist as string[] | null) ?? null,
    httpPreferSse: row.httpPreferSse ?? false,
    timeoutMs: row.timeoutMs ?? null,
    autoReconnect: row.autoReconnect ?? true,
    lastStatus: (row.lastStatus as McpServer['lastStatus']) ?? null,
    lastError: row.lastError ?? null,
    lastConnectedAt: row.lastConnectedAt?.toISOString() ?? null,
    lastTestedAt: row.lastTestedAt?.toISOString() ?? null,
    discoveredTools: (row.discoveredTools as McpDiscoveredTool[] | null) ?? null,
    discoveredResources: (row.discoveredResources as McpDiscoveredResource[] | null) ?? null,
    discoveredPrompts: (row.discoveredPrompts as McpDiscoveredPrompt[] | null) ?? null,
    metadata: (row.metadata as Record<string, unknown> | null) ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

function toEventDto(row: typeof mcpConnectionEvents.$inferSelect): McpConnectionEvent {
  return {
    id: row.id,
    serverId: row.serverId,
    eventType: row.eventType,
    status: row.status ?? null,
    transportKind: row.transportKind ?? null,
    detail: (row.detail as Record<string, unknown> | null) ?? null,
    createdAt: row.createdAt.toISOString(),
  }
}

export type McpServerWrite = {
  name: string
  description?: string | null
  transport: McpServer['transport']
  command?: string | null
  url?: string | null
  env?: Record<string, string> | null
  headers?: Record<string, string> | null
  enabled?: boolean
  toolWhitelist?: string[] | null
  httpPreferSse?: boolean
  timeoutMs?: number | null
  autoReconnect?: boolean
  metadata?: Record<string, unknown> | null
}

export type McpServerPatch = Partial<McpServerWrite>

export type ConnectionSnapshot = {
  status: NonNullable<McpServer['lastStatus']>
  error?: string | null
  transportKind?: string | null
  tools?: McpDiscoveredTool[]
  resources?: McpDiscoveredResource[]
  prompts?: McpDiscoveredPrompt[]
  tested?: boolean
}

export const mcpServersRepo = {
  async list(): Promise<McpServer[]> {
    const db = getDb()
    const rows = await db.select().from(mcpServers).orderBy(desc(mcpServers.updatedAt))
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

  async create(input: McpServerWrite): Promise<McpServer> {
    const db = getDb()
    const now = new Date()
    const [row] = await db
      .insert(mcpServers)
      .values({
        name: input.name,
        description: input.description ?? null,
        transport: input.transport,
        command: input.command ?? null,
        url: input.url ?? null,
        env: input.env ?? null,
        headers: input.headers ?? null,
        enabled: input.enabled ?? true,
        toolWhitelist: input.toolWhitelist ?? null,
        httpPreferSse: input.httpPreferSse ?? false,
        timeoutMs: input.timeoutMs ?? null,
        autoReconnect: input.autoReconnect ?? true,
        metadata: input.metadata ?? null,
        updatedAt: now,
      })
      .returning()
    if (!row) throw new Error('Failed to create MCP server')
    return toDto(row)
  },

  async update(id: string, patch: McpServerPatch): Promise<McpServer | null> {
    const db = getDb()
    const [row] = await db
      .update(mcpServers)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(mcpServers.id, id))
      .returning()
    return row ? toDto(row) : null
  },

  async delete(id: string): Promise<boolean> {
    const db = getDb()
    const result = await db
      .delete(mcpServers)
      .where(eq(mcpServers.id, id))
      .returning({ id: mcpServers.id })
    const deleted = result.length > 0
    if (deleted) {
      await cronRepo.removeDeletedMcpServerBinding(id)
    }
    return deleted
  },

  /** Persist live connection outcome + discovery cache for UI retrieval after restart. */
  async recordConnection(id: string, snap: ConnectionSnapshot): Promise<McpServer | null> {
    const db = getDb()
    const now = new Date()
    const patch: Record<string, unknown> = {
      lastStatus: snap.status,
      lastError: snap.error ?? null,
      updatedAt: now,
    }
    if (snap.status === 'connected') patch.lastConnectedAt = now
    if (snap.tested !== false) patch.lastTestedAt = now
    if (snap.tools) patch.discoveredTools = snap.tools
    if (snap.resources) patch.discoveredResources = snap.resources
    if (snap.prompts) patch.discoveredPrompts = snap.prompts

    const [row] = await db.update(mcpServers).set(patch).where(eq(mcpServers.id, id)).returning()

    await db.insert(mcpConnectionEvents).values({
      serverId: id,
      eventType: snap.status === 'connected' ? 'connected' : snap.status === 'error' ? 'error' : 'status',
      status: snap.status,
      transportKind: snap.transportKind ?? null,
      detail: {
        error: snap.error ?? null,
        toolCount: snap.tools?.length ?? 0,
        resourceCount: snap.resources?.length ?? 0,
        promptCount: snap.prompts?.length ?? 0,
      },
    })

    return row ? toDto(row) : null
  },

  async listEvents(serverId: string, limit = 50): Promise<McpConnectionEvent[]> {
    const db = getDb()
    const rows = await db
      .select()
      .from(mcpConnectionEvents)
      .where(eq(mcpConnectionEvents.serverId, serverId))
      .orderBy(desc(mcpConnectionEvents.createdAt))
      .limit(limit)
    return rows.map(toEventDto)
  },

  /** Delete `mcp_connection_events` older than `days` (based on `created_at`). Returns deleted row count. */
  async pruneConnectionEventsOlderThan(days: number): Promise<number> {
    if (!Number.isFinite(days) || days < 1) {
      throw new Error(`pruneConnectionEventsOlderThan: days must be >= 1 (got ${days})`)
    }
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    const db = getDb()
    const deleted = await db
      .delete(mcpConnectionEvents)
      .where(lt(mcpConnectionEvents.createdAt, cutoff))
      .returning({ id: mcpConnectionEvents.id })
    return deleted.length
  },
}
