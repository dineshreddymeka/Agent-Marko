import { registerTool, unregisterToolsByPrefix, unregisterTool } from '../agent/tools/registry'
import { McpError } from '../errors'
import { isDebugChannel, logger } from '../log'
import { getClient, getToolMetas, type McpToolMeta } from './manager'

const log = logger.child({ component: 'mcp-bridge' })

function registerMeta(meta: McpToolMeta): void {
  registerTool({
    name: meta.namespaced,
    description: meta.description,
    dangerous: meta.dangerous,
    mcpServerId: meta.serverId,
    parameters: meta.parameters,
    async execute(args, ctx) {
      const toolLog = log.child({
        toolName: meta.namespaced,
        runId: ctx.runId,
        threadId: ctx.sessionId,
      })
      const end = isDebugChannel('tools') || isDebugChannel('mcp')
        ? toolLog.time('mcp.tool', { toolName: meta.namespaced })
        : null

      const client = getClient(meta.serverId)
      if (!client) throw new McpError(`MCP client disconnected: ${meta.serverName}`)
      if (ctx.signal.aborted) throw new McpError('MCP tool call aborted')

      try {
        const result = await client.callTool(
          { name: meta.toolName, arguments: args },
          undefined,
          { signal: ctx.signal },
        )

        const maybeError = result as { isError?: boolean; content?: unknown }
        if (maybeError.isError) {
          const content = maybeError.content
          const text =
            Array.isArray(content) &&
            content[0] &&
            typeof content[0] === 'object' &&
            content[0] !== null &&
            'text' in content[0]
              ? String((content[0] as { text: string }).text)
              : JSON.stringify(content)
          const err = new McpError(text || `MCP tool ${meta.namespaced} failed`, result)
          toolLog.warn('MCP tool returned error', { error: err })
          end?.({ error: err })
          throw err
        }

        end?.({ ok: true })
        return result
      } catch (err) {
        toolLog.error('MCP tool invoke failed', { error: err })
        end?.({ error: err })
        throw err
      }
    },
  })
}

export function bridgeMcpTools(): void {
  unregisterToolsByPrefix('mcp:')
  const metas = getToolMetas()
  for (const meta of metas) {
    registerMeta(meta)
  }
  if (isDebugChannel('mcp')) {
    log.debug('MCP tool bridge refreshed', { count: metas.length })
  }
}

export async function refreshMcpToolBridge(): Promise<void> {
  bridgeMcpTools()
}

export function unbridgeServerTools(serverName: string): void {
  const prefix = `mcp:${serverName}/`
  for (const meta of getToolMetas()) {
    if (meta.namespaced.startsWith(prefix)) {
      unregisterTool(meta.namespaced)
    }
  }
}
