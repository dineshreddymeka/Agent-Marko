import type { McpServer } from '@hermes/shared'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { logger, isDebugChannel } from '../log'
import { mcpServersRepo } from '../db/repositories/mcp_servers'
import { createHttpMcpTransport, createHttpTransportSync } from './http-transport'
import { McpError } from '../errors'

const log = logger.child({ component: 'mcp' })

export type McpConnectionState = {
  serverId: string
  name: string
  status: 'connected' | 'disconnected' | 'error' | 'reconnecting'
  tools: string[]
  resources: string[]
  prompts: string[]
  transportKind?: 'stdio' | 'streamable-http' | 'sse'
  error?: string
}

export type McpToolMeta = {
  serverId: string
  serverName: string
  toolName: string
  namespaced: string
  description: string
  parameters: Record<string, unknown>
  dangerous: boolean
}

export type McpResourceMeta = {
  serverId: string
  serverName: string
  uri: string
  name: string
  description?: string
  mimeType?: string
}

export type McpPromptMeta = {
  serverId: string
  serverName: string
  name: string
  description?: string
  /** Slash command form: /mcp:server:prompt */
  slash: string
}

const clients = new Map<string, Client>()
const states = new Map<string, McpConnectionState>()
const toolMetas = new Map<string, McpToolMeta>()
const resourceMetas = new Map<string, McpResourceMeta>()
const promptMetas = new Map<string, McpPromptMeta>()
const serverConfigs = new Map<string, McpServer>()
const reconnectTimers = new Map<string, ReturnType<typeof setTimeout>>()
const reconnectAttempts = new Map<string, number>()

function namespacedTool(serverName: string, toolName: string): string {
  return `mcp:${serverName}/${toolName}`
}

function isWhitelisted(server: McpServer, toolName: string): boolean {
  const list = server.toolWhitelist
  if (!list || list.length === 0) return false
  return list.includes(toolName) || list.includes(namespacedTool(server.name, toolName))
}

function clearReconnect(serverId: string): void {
  const t = reconnectTimers.get(serverId)
  if (t) clearTimeout(t)
  reconnectTimers.delete(serverId)
}

function scheduleReconnect(serverId: string): void {
  const server = serverConfigs.get(serverId)
  if (!server?.enabled || server.autoReconnect === false) return
  clearReconnect(serverId)
  const attempt = (reconnectAttempts.get(serverId) ?? 0) + 1
  reconnectAttempts.set(serverId, attempt)
  const delay = Math.min(30_000, 1000 * 1.5 ** Math.min(attempt, 10))
  const state = states.get(serverId)
  if (state) {
    states.set(serverId, { ...state, status: 'reconnecting', error: `reconnect in ${Math.round(delay)}ms` })
    void mcpServersRepo
      .recordConnection(serverId, {
        status: 'reconnecting',
        error: `reconnect in ${Math.round(delay)}ms`,
        tested: false,
      })
      .catch(() => undefined)
  }
  log.info('MCP scheduling reconnect', { server: server.name, attempt, delay })
  reconnectTimers.set(
    serverId,
    setTimeout(() => {
      void connectServer(server).then(async (s) => {
        if (s.status === 'connected') {
          reconnectAttempts.set(serverId, 0)
          const { refreshMcpToolBridge } = await import('./tool-bridge')
          await refreshMcpToolBridge()
          log.info('MCP reconnected', { server: server.name, attempt })
        } else {
          scheduleReconnect(serverId)
        }
      })
    }, delay),
  )
}

async function closeClient(serverId: string): Promise<void> {
  const existing = clients.get(serverId)
  if (!existing) return
  try {
    await existing.close()
  } catch {
    // ignore
  }
  clients.delete(serverId)
  for (const [key, meta] of toolMetas) {
    if (meta.serverId === serverId) toolMetas.delete(key)
  }
  for (const [key, meta] of resourceMetas) {
    if (meta.serverId === serverId) resourceMetas.delete(key)
  }
  for (const [key, meta] of promptMetas) {
    if (meta.serverId === serverId) promptMetas.delete(key)
  }
}

function attachTransportWatchers(server: McpServer, transport: Transport): void {
  const prevError = transport.onerror
  const prevClose = transport.onclose
  transport.onerror = (err) => {
    prevError?.(err)
    log.warn('MCP transport error', { server: server.name, error: err })
    scheduleReconnect(server.id)
  }
  transport.onclose = () => {
    prevClose?.()
    log.warn('MCP transport closed', { server: server.name })
    if (serverConfigs.get(server.id)?.enabled) {
      scheduleReconnect(server.id)
    }
  }
}

async function connectWithTransport(
  server: McpServer,
  transport: Transport,
  transportKind: McpConnectionState['transportKind'],
): Promise<McpConnectionState> {
  await closeClient(server.id)
  clearReconnect(server.id)
  attachTransportWatchers(server, transport)

  const client = new Client({ name: 'open-jarvis', version: '0.2.0' })
  await client.connect(transport)
  clients.set(server.id, client)
  serverConfigs.set(server.id, server)

  const toolsResult = await client.listTools()
  const tools: string[] = []
  for (const t of toolsResult.tools) {
    const namespaced = namespacedTool(server.name, t.name)
    tools.push(namespaced)
    toolMetas.set(namespaced, {
      serverId: server.id,
      serverName: server.name,
      toolName: t.name,
      namespaced,
      description: t.description ?? `MCP tool ${t.name} from ${server.name}`,
      parameters: (t.inputSchema as Record<string, unknown>) ?? {
        type: 'object',
        properties: {},
      },
      dangerous: !isWhitelisted(server, t.name),
    })
  }

  const resources: string[] = []
  try {
    const res = await client.listResources()
    for (const r of res.resources) {
      resources.push(r.uri)
      resourceMetas.set(`${server.name}:${r.uri}`, {
        serverId: server.id,
        serverName: server.name,
        uri: r.uri,
        name: r.name,
        description: r.description,
        mimeType: r.mimeType,
      })
    }
  } catch {
    // resources optional
  }

  const prompts: string[] = []
  try {
    const p = await client.listPrompts()
    for (const prompt of p.prompts) {
      const slash = `/mcp:${server.name}:${prompt.name}`
      prompts.push(slash)
      promptMetas.set(slash, {
        serverId: server.id,
        serverName: server.name,
        name: prompt.name,
        description: prompt.description,
        slash,
      })
    }
  } catch {
    // prompts optional
  }

  const state: McpConnectionState = {
    serverId: server.id,
    name: server.name,
    status: 'connected',
    tools,
    resources,
    prompts,
    transportKind,
  }
  states.set(server.id, state)
  reconnectAttempts.set(server.id, 0)
  try {
    await mcpServersRepo.recordConnection(server.id, {
      status: 'connected',
      transportKind,
      tools: tools.map((name) => ({ name })),
      resources: resources.map((uri) => ({ uri })),
      prompts: prompts.map((name) => ({ name })),
      tested: true,
    })
  } catch (err) {
    log.warn('Failed to persist MCP connection', { server: server.name, error: err })
  }
  log.info('MCP connected', {
    server: server.name,
    transportKind,
    tools: tools.length,
    resources: resources.length,
    prompts: prompts.length,
  })
  return state
}

async function withConnectTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number | null | undefined,
): Promise<T> {
  if (timeoutMs == null || timeoutMs <= 0) return promise
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () => reject(new McpError(`MCP connect timed out after ${timeoutMs}ms`)),
          timeoutMs,
        )
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export async function connectServer(server: McpServer): Promise<McpConnectionState> {
  serverConfigs.set(server.id, server)
  if (!server.enabled) {
    clearReconnect(server.id)
    await closeClient(server.id)
    const state: McpConnectionState = {
      serverId: server.id,
      name: server.name,
      status: 'disconnected',
      tools: [],
      resources: [],
      prompts: [],
    }
    states.set(server.id, state)
    try {
      await mcpServersRepo.recordConnection(server.id, {
        status: 'disconnected',
        tested: false,
      })
    } catch {
      // ignore persist failure
    }
    return state
  }

  try {
    return await withConnectTimeout(connectOnce(server), server.timeoutMs)
  } catch (err) {
    await closeClient(server.id)
    const state: McpConnectionState = {
      serverId: server.id,
      name: server.name,
      status: 'error',
      tools: [],
      resources: [],
      prompts: [],
      error: String(err instanceof Error ? err.message : err),
    }
    states.set(server.id, state)
    log.warn('MCP connect failed', { server: server.name, error: err })
    try {
      await mcpServersRepo.recordConnection(server.id, {
        status: 'error',
        error: state.error,
        tested: true,
      })
    } catch {
      // ignore persist failure
    }
    if (server.enabled) scheduleReconnect(server.id)
    return state
  }
}

async function connectOnce(server: McpServer): Promise<McpConnectionState> {
  if (server.transport === 'stdio') {
    if (!server.command) throw new McpError('stdio transport requires command')
    const parts = server.command.split(/\s+/).filter(Boolean)
    const command = parts[0]!
    const args = parts.slice(1)
    const transport = new StdioClientTransport({
      command,
      args,
      env: { ...process.env, ...(server.env ?? {}) } as Record<string, string>,
    })
    return await connectWithTransport(server, transport, 'stdio')
  }

  if (server.transport === 'http') {
    if (!server.url) throw new McpError('http transport requires url')
    const attemptErrors: string[] = []
    const preferOrder = server.httpPreferSse ? [true, false] : [false, true]
    for (const preferSse of preferOrder) {
      const label = preferSse ? 'sse' : 'streamable-http'
      try {
        const { transport, kind } = preferSse
          ? createHttpTransportSync({
              url: server.url,
              headers: server.headers,
              preferSse: true,
            })
          : await createHttpMcpTransport({
              url: server.url,
              headers: server.headers,
            })
        return await connectWithTransport(server, transport, kind)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        attemptErrors.push(`${label}: ${msg}`)
        if (isDebugChannel('mcp')) {
          log.debug('MCP HTTP connect attempt failed', {
            server: server.name,
            preferSse,
            error: err,
          })
        }
      }
    }
    throw new McpError(
      attemptErrors.length
        ? `HTTP MCP connect failed (${attemptErrors.join(' | ')})`
        : 'HTTP MCP connect failed',
    )
  }

  throw new McpError(`Unsupported MCP transport: ${server.transport}`)
}

export async function connectAll(): Promise<McpConnectionState[]> {
  const servers = await mcpServersRepo.getEnabled()
  return Promise.all(servers.map(connectServer))
}

export function getConnectionStates(): McpConnectionState[] {
  return [...states.values()]
}

export function getClient(serverId: string): Client | undefined {
  return clients.get(serverId)
}

export function getToolMetas(): McpToolMeta[] {
  return [...toolMetas.values()]
}

export function getToolMeta(namespaced: string): McpToolMeta | undefined {
  return toolMetas.get(namespaced)
}

export function getResourceMetas(): McpResourceMeta[] {
  return [...resourceMetas.values()]
}

export function getPromptMetas(): McpPromptMeta[] {
  return [...promptMetas.values()]
}

export async function readMcpResource(serverId: string, uri: string): Promise<string> {
  const client = clients.get(serverId)
  if (!client) throw new McpError('MCP client disconnected')
  const result = await client.readResource({ uri })
  const parts: string[] = []
  for (const c of result.contents) {
    if ('text' in c && typeof c.text === 'string') parts.push(c.text)
    else if ('blob' in c) parts.push(`[binary ${c.mimeType ?? 'blob'}]`)
  }
  return parts.join('\n')
}

export async function disconnectServer(serverId: string): Promise<void> {
  clearReconnect(serverId)
  serverConfigs.delete(serverId)
  await closeClient(serverId)
  states.delete(serverId)
}

export async function disconnectAll(): Promise<void> {
  for (const id of [...serverConfigs.keys()]) {
    clearReconnect(id)
  }
  for (const id of [...clients.keys()]) {
    await closeClient(id)
  }
  states.clear()
  toolMetas.clear()
  resourceMetas.clear()
  promptMetas.clear()
  serverConfigs.clear()
}
