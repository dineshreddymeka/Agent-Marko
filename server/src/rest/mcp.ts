import { jsonResponse, parseJson } from './helpers'

export async function handleMcp(req: Request, path: string): Promise<Response | null> {
  const { mcpServersRepo } = await import('../db/repositories/mcp_servers')
  const { connectServer, getConnectionStates } = await import('../mcp/manager')
  const parts = path.split('/').filter(Boolean)

  if (req.method === 'GET' && parts.length === 2) {
    const servers = await mcpServersRepo.list()
    const states = getConnectionStates()
    return jsonResponse({ servers, states })
  }

  if (req.method === 'POST' && parts.length === 2) {
    const body = await parseJson(req)
    if (!body?.name || !body?.transport) {
      return jsonResponse({ error: 'name and transport required' }, 400)
    }
    const server = await mcpServersRepo.create({
      name: String(body.name),
      transport: body.transport as 'stdio' | 'http',
      command: body.command ? String(body.command) : null,
      url: body.url ? String(body.url) : null,
      env: body.env as Record<string, string> | null,
      headers: body.headers as Record<string, string> | null,
      enabled: body.enabled !== false,
      toolWhitelist: body.toolWhitelist as string[] | null,
    })
    return jsonResponse(server, 201)
  }

  if (parts.length === 4 && parts[3] === 'test' && req.method === 'POST') {
    const server = await mcpServersRepo.getById(parts[2]!)
    if (!server) return jsonResponse({ error: 'Not found' }, 404)
    const state = await connectServer(server)
    return jsonResponse(state)
  }

  if (parts.length === 3) {
    const id = parts[2]!
    if (req.method === 'PATCH') {
      const body = await parseJson(req)
      const server = await mcpServersRepo.update(id, body ?? {})
      if (!server) return jsonResponse({ error: 'Not found' }, 404)
      return jsonResponse(server)
    }
    if (req.method === 'DELETE') {
      return jsonResponse({ deleted: await mcpServersRepo.delete(id) })
    }
  }

  return null
}
