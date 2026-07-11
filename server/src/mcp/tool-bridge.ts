import { registerTool } from '../agent/tools/registry'
import { getClient, getConnectionStates } from './manager'

export function bridgeMcpTools(): void {
  for (const state of getConnectionStates()) {
    if (state.status !== 'connected') continue
    for (const toolName of state.tools) {
      registerTool({
        name: toolName,
        description: `MCP tool from ${state.name}`,
        dangerous: true,
        parameters: { type: 'object', properties: {} },
        async execute(args) {
          const client = getClient(state.serverId)
          if (!client) return { error: 'MCP client disconnected' }
          const rawName = toolName.split('/').pop()!
          return client.callTool({ name: rawName, arguments: args })
        },
      })
    }
  }
}

export async function refreshMcpToolBridge(): Promise<void> {
  bridgeMcpTools()
}
