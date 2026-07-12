/**
 * Open Jarvis — MCP Connections REST (CRUD + test + event history).
 * Author: Dinesh Reddy Meka
 */
import { jsonResponse, parseJson } from './helpers'

export async function handleMcp(req: Request, path: string): Promise<Response | null> {
  const { mcpServersRepo } = await import('../db/repositories/mcp_servers')
  const {
    connectServer,
    disconnectServer,
    getConnectionStates,
  } = await import('../mcp/manager')
  const { refreshMcpToolBridge } = await import('../mcp/tool-bridge')
  const parts = path.split('/').filter(Boolean)

  if (req.method === 'GET' && parts.length === 2) {
    const servers = await mcpServersRepo.list()
    const states = getConnectionStates()
    return jsonResponse({ servers, states })
  }

  if (req.method === 'GET' && parts.length === 3 && parts[2] === 'prompts') {
    const { getPromptMetas } = await import('../mcp/manager')
    return jsonResponse({ prompts: getPromptMetas() })
  }

  if (req.method === 'GET' && parts.length === 3 && parts[2] === 'resources') {
    const { getResourceMetas } = await import('../mcp/manager')
    return jsonResponse({ resources: getResourceMetas() })
  }

  if (req.method === 'POST' && parts.length === 2) {
    const body = await parseJson(req)
    if (!body?.name || !body?.transport) {
      return jsonResponse(
        { error: 'name and transport required', message: 'name and transport required' },
        400,
      )
    }
    if (body.transport === 'http' && !body.url) {
      return jsonResponse(
        { error: 'url required for http transport', message: 'url required for http transport' },
        400,
      )
    }
    if (body.transport === 'stdio' && !body.command) {
      return jsonResponse(
        {
          error: 'command required for stdio transport',
          message: 'command required for stdio transport',
        },
        400,
      )
    }
    let server
    try {
      server = await mcpServersRepo.create({
        name: String(body.name),
        description: body.description != null ? String(body.description) : null,
        transport: body.transport as 'stdio' | 'http',
        command: body.command ? String(body.command) : null,
        url: body.url ? String(body.url) : null,
        env: body.env as Record<string, string> | null,
        headers: body.headers as Record<string, string> | null,
        enabled: body.enabled !== false,
        toolWhitelist: body.toolWhitelist as string[] | null,
        httpPreferSse: Boolean(body.httpPreferSse),
        timeoutMs:
          body.timeoutMs != null && body.timeoutMs !== ''
            ? Number(body.timeoutMs)
            : null,
        autoReconnect: body.autoReconnect !== false,
        metadata: (body.metadata as Record<string, unknown> | null) ?? null,
      })
    } catch (err) {
      const msg = String(err)
      if (/unique|duplicate|23505/i.test(msg)) {
        return jsonResponse(
          {
            error: 'A server with this name already exists',
            message: 'A server with this name already exists',
          },
          409,
        )
      }
      throw err
    }
    if (server.enabled) {
      await connectServer(server)
      await refreshMcpToolBridge()
    }
    const refreshed = (await mcpServersRepo.getById(server.id)) ?? server
    return jsonResponse(refreshed, 201)
  }

  if (parts.length === 4 && parts[3] === 'events' && req.method === 'GET') {
    const server = await mcpServersRepo.getById(parts[2]!)
    if (!server) return jsonResponse({ error: 'Not found' }, 404)
    const events = await mcpServersRepo.listEvents(server.id)
    return jsonResponse({ events })
  }

  if (parts.length === 4 && parts[3] === 'test' && req.method === 'POST') {
    let server = await mcpServersRepo.getById(parts[2]!)
    if (!server) return jsonResponse({ error: 'Not found', message: 'Not found' }, 404)
    // Connect/Test from UI should enable a disabled server, then connect.
    if (!server.enabled) {
      server =
        (await mcpServersRepo.update(server.id, { enabled: true })) ?? {
          ...server,
          enabled: true,
        }
    }
    const state = await connectServer(server)
    if (state.status === 'connected') await refreshMcpToolBridge()
    const refreshed = await mcpServersRepo.getById(server.id)
    return jsonResponse({ state, server: refreshed })
  }

  if (parts.length === 3) {
    const id = parts[2]!
    if (req.method === 'PATCH') {
      const body = (await parseJson(req)) ?? {}
      const patch: Record<string, unknown> = {}
      for (const key of [
        'name',
        'description',
        'transport',
        'command',
        'url',
        'env',
        'headers',
        'enabled',
        'toolWhitelist',
        'httpPreferSse',
        'timeoutMs',
        'autoReconnect',
        'metadata',
      ] as const) {
        if (key in body) patch[key] = body[key]
      }
      const server = await mcpServersRepo.update(id, patch as Parameters<typeof mcpServersRepo.update>[1])
      if (!server) return jsonResponse({ error: 'Not found' }, 404)
      if (server.enabled) {
        await connectServer(server)
      } else {
        await disconnectServer(server.id)
      }
      await refreshMcpToolBridge()
      return jsonResponse(server)
    }
    if (req.method === 'DELETE') {
      await disconnectServer(id)
      await refreshMcpToolBridge()
      return jsonResponse({ deleted: await mcpServersRepo.delete(id) })
    }
  }

  return null
}
