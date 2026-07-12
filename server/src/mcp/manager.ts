import type { McpServer } from '@hermes/shared'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { logger } from '../log'
import { mcpServersRepo } from '../db/repositories/mcp_servers'

export type McpConnectionState = {
  serverId: string
  name: string
  status: 'connected' | 'disconnected' | 'error'
  tools: string[]
  error?: string
}

const clients = new Map<string, Client>()
const states = new Map<string, McpConnectionState>()

export async function connectServer(server: McpServer): Promise<McpConnectionState> {
  if (!server.enabled) {
    return { serverId: server.id, name: server.name, status: 'disconnected', tools: [] }
  }

  try {
    if (server.transport === 'stdio') {
      if (!server.command) throw new Error('stdio transport requires command')
      const parts = server.command.split(/\s+/)
      const command = parts[0]!
      const args = parts.slice(1)
      const transport = new StdioClientTransport({
        command,
        args,
        env: { ...process.env, ...(server.env ?? {}) },
      })
      const client = new Client({ name: 'hermes-ui', version: '0.2.0' })
      await client.connect(transport)
      clients.set(server.id, client)
      const toolsResult = await client.listTools()
      const tools = toolsResult.tools.map((t) => `mcp:${server.name}/${t.name}`)
      const state: McpConnectionState = {
        serverId: server.id,
        name: server.name,
        status: 'connected',
        tools,
      }
      states.set(server.id, state)
      return state
    }

    // HTTP transport stub
    const state: McpConnectionState = {
      serverId: server.id,
      name: server.name,
      status: 'disconnected',
      tools: [],
      error: 'HTTP MCP transport stub — not yet implemented',
    }
    states.set(server.id, state)
    return state
  } catch (err) {
    const state: McpConnectionState = {
      serverId: server.id,
      name: server.name,
      status: 'error',
      tools: [],
      error: String(err),
    }
    states.set(server.id, state)
    logger.warn('MCP connect failed', { server: server.name, error: String(err) })
    return state
  }
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

export async function disconnectAll(): Promise<void> {
  for (const client of clients.values()) {
    try {
      await client.close()
    } catch {
      // ignore
    }
  }
  clients.clear()
  states.clear()
}
