import type { LlmTool } from '../llm'

export type ToolContext = {
  sessionId: string
  runId: string
  signal: AbortSignal
}

export type ToolDefinition = {
  name: string
  description: string
  parameters: Record<string, unknown>
  dangerous?: boolean
  execute: (args: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>
}

const tools = new Map<string, ToolDefinition>()

export function registerTool(tool: ToolDefinition): void {
  tools.set(tool.name, tool)
}

export function getTool(name: string): ToolDefinition | undefined {
  return tools.get(name)
}

export function listTools(): ToolDefinition[] {
  return [...tools.values()]
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
  return tools.get(name)?.dangerous ?? false
}
