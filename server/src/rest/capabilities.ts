import { jsonResponse } from './helpers'
import {
  getCapabilityManifest,
  refreshCapabilityManifest,
  getAgentLlmHealthSnapshot,
} from '../capabilities'

export async function handleCapabilities(req: Request, path: string): Promise<Response | null> {
  const parts = path.split('/').filter(Boolean)
  // /api/capabilities
  if (parts.length === 2 && parts[0] === 'api' && parts[1] === 'capabilities') {
    if (req.method === 'GET') {
      const manifest = await getCapabilityManifest()
      return jsonResponse({
        ...manifest,
        agentLlm: getAgentLlmHealthSnapshot(),
      })
    }
    if (req.method === 'POST') {
      const manifest = await refreshCapabilityManifest('api')
      return jsonResponse({
        ok: true,
        refreshedAt: manifest.refreshedAt,
        tools: manifest.tools.length,
        skills: manifest.skills.length,
        plugins: manifest.plugins.length,
      })
    }
  }

  // /api/capabilities/warm — reconnect enabled MCP + rebuild manifest
  if (
    parts.length === 3 &&
    parts[0] === 'api' &&
    parts[1] === 'capabilities' &&
    parts[2] === 'warm' &&
    req.method === 'POST'
  ) {
    try {
      const { connectAll } = await import('../mcp/manager')
      const { refreshMcpToolBridge } = await import('../mcp/tool-bridge')
      await connectAll()
      await refreshMcpToolBridge()
    } catch (err) {
      const { logger } = await import('../log')
      logger.warn('capabilities warm: MCP reconnect failed', { error: String(err) })
    }
    const manifest = await refreshCapabilityManifest('warm')
    return jsonResponse({
      ok: true,
      refreshedAt: manifest.refreshedAt,
      tools: manifest.tools.length,
      skills: manifest.skills.length,
      plugins: manifest.plugins.length,
    })
  }

  return null
}
