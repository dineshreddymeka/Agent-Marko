import type { LlmTool } from '../agent/llm'

export type CapabilityKind = 'tool' | 'skill' | 'mcp_server' | 'cowork' | 'slash'

export type CircuitState = 'closed' | 'open' | 'half_open'

export type RoutingMode = 'legacy' | 'capabilities'

export type CapabilityTool = {
  name: string
  source: 'native' | 'mcp'
  server?: string
  serverId?: string
  dangerous: boolean
  description: string
  trusted: boolean
}

export type CapabilitySkill = {
  id: string
  name: string
  description: string
  triggers: string[] | null
  source: string
}

export type CapabilityPlugin = {
  id: string
  kind: 'mcp' | 'cowork'
  name: string
  status: string
  toolCount: number
  trusted: boolean
}

export type CapabilitySlashCommand = {
  name: string
  server: string
  description: string
}

export type CapabilityManifest = {
  tools: CapabilityTool[]
  skills: CapabilitySkill[]
  plugins: CapabilityPlugin[]
  slashCommands: CapabilitySlashCommand[]
  refreshedAt: string
  retrievalMode: 'semantic' | 'lexical' | 'legacy'
  routing: RoutingMode
}

export type AgentLlmRoute = {
  baseUrl: string
  toolsEnabled: boolean
  degraded: boolean
  reason: 'agent' | 'bridge_fallback' | 'mock' | 'legacy'
  circuitState: CircuitState
  lastFailure: string | null
}

export type ToolsForTurn = {
  tools: LlmTool[]
  retrievalMode: 'semantic' | 'lexical' | 'legacy'
  offered: string[]
}
