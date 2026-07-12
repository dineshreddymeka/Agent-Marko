import type { LlmTool } from '../llm'
import { getCronBindings } from '../../cron/run-bindings'

export type ToolContext = {
  sessionId: string
  runId: string
  signal: AbortSignal
  /** Parent run emitter — used by delegate_to_agent to nest events */
  emit?: import('../../agui/events').EventEmitter
}

export type ToolDefinition = {
  name: string
  description: string
  parameters: Record<string, unknown>
  dangerous?: boolean
  /** Set for MCP-bridged tools — enables per-run server allowlists (cron workflows). */
  mcpServerId?: string
  execute: (args: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>
}

const tools = new Map<string, ToolDefinition>()

export function registerTool(tool: ToolDefinition): void {
  tools.set(tool.name, tool)
}

export function unregisterTool(name: string): boolean {
  return tools.delete(name)
}

export function unregisterToolsByPrefix(prefix: string): number {
  let removed = 0
  for (const name of tools.keys()) {
    if (name.startsWith(prefix)) {
      tools.delete(name)
      removed++
    }
  }
  return removed
}

/**
 * Cron-fired runs carry an MCP allowlist in AsyncLocalStorage: MCP tools from
 * servers outside the allowlist are hidden. An EMPTY allowlist means no MCP
 * tools at all (not "all servers"). Non-cron runs are unaffected.
 */
function isAllowedInCurrentRun(tool: ToolDefinition): boolean {
  const bindings = getCronBindings()
  if (!bindings) return true
  if (!tool.name.startsWith('mcp:')) return true
  return tool.mcpServerId != null && bindings.mcpServerIds.includes(tool.mcpServerId)
}

export function getTool(name: string): ToolDefinition | undefined {
  const tool = tools.get(name)
  if (tool && !isAllowedInCurrentRun(tool)) return undefined
  return tool
}

export function listTools(): ToolDefinition[] {
  return [...tools.values()].filter(isAllowedInCurrentRun)
}

export function toLlmTools(): LlmTool[] {
  return listTools().map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }))
}

export function isDangerous(name: string): boolean {
  const tool = tools.get(name)
  if (tool) return tool.dangerous ?? false
  // Unregistered MCP-namespaced tools stay approval-gated
  if (name.startsWith('mcp:')) return true
  return false
}
