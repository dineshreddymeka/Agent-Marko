import { jsonResponse } from './helpers'
import {
  getCapabilityManifest,
  refreshCapabilityManifest,
  getAgentLlmHealthSnapshot,
  probeAgentLlmHealth,
} from '../capabilities'

export async function handleCapabilities(req: Request, path: string): Promise<Response | null> {
  const parts = path.split('/').filter(Boolean)
  // /api/capabilities
  if (parts.length === 2 && parts[0] === 'api' && parts[1] === 'capabilities') {
    if (req.method === 'GET') {
      const url = new URL(req.url)
      const probe = url.searchParams.get('probe') === '1'
      const manifest = await getCapabilityManifest()
      const agentLlm = probe ? await probeAgentLlmHealth() : getAgentLlmHealthSnapshot()
      return jsonResponse({
        ...manifest,
        agentLlm,
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
        slashCommands: manifest.slashCommands.length,
        providers: manifest.providers.length,
        agentLlm: getAgentLlmHealthSnapshot(),
      })
    }
  }

  // /api/capabilities/warm — reconnect enabled MCP + rebuild manifest + probe agent LLM
  if (
    parts.length === 3 &&
    parts[0] === 'api' &&
    parts[1] === 'capabilities' &&
    parts[2] === 'warm' &&
    req.method === 'POST'
  ) {
    let mcpReconnectOk = true
    let mcpReconnectError: string | null = null
    try {
      const { connectAll } = await import('../mcp/manager')
      const { refreshMcpToolBridge } = await import('../mcp/tool-bridge')
      // Bound reconnect so staging/ops warm never hangs indefinitely (stdio MCP can stall).
      const warmMcpMs = Math.min(
        Math.max(Number(process.env.HERMES_CAPABILITIES_WARM_MCP_MS ?? 15_000) || 15_000, 100),
        60_000,
      )
      await Promise.race([
        (async () => {
          await connectAll()
          await refreshMcpToolBridge()
        })(),
        Bun.sleep(warmMcpMs).then(() => {
          throw new Error(`MCP reconnect timed out after ${warmMcpMs}ms`)
        }),
      ])
    } catch (err) {
      mcpReconnectOk = false
      mcpReconnectError = err instanceof Error ? err.message : String(err)
      const { logger } = await import('../log')
      logger.warn('capabilities warm: MCP reconnect failed', { error: mcpReconnectError })
    }
    const manifest = await refreshCapabilityManifest('warm')
    const agentLlm = await probeAgentLlmHealth()
    return jsonResponse({
      ok: true,
      refreshedAt: manifest.refreshedAt,
      tools: manifest.tools.length,
      skills: manifest.skills.length,
      plugins: manifest.plugins.length,
      slashCommands: manifest.slashCommands.length,
      providers: manifest.providers.length,
      mcpReconnect: {
        ok: mcpReconnectOk,
        error: mcpReconnectError,
      },
      agentLlm,
    })
  }

  return null
}
