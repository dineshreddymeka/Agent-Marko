/**
 * Infra router: endpoint selection + tools-for-turn assembly.
 * Product decisions (which tool) are left to the LLM.
 */
import { isMockLlmEnabled } from '../agent/mock-llm'
import { config } from '../config'
import { resolveAgentLlmRoute } from './health'
import { getToolsForTurn } from './retrieve'
import type { AgentLlmRoute, ToolsForTurn } from './types'

export type TurnCapabilityPlan = {
  route: AgentLlmRoute
  tools: ToolsForTurn
  /** Pre-LLM interceptors only in degraded/legacy bridge modes. */
  allowPreLlmInterceptors: boolean
}

export function threadQueryFromMessages(
  messages: Array<{ role?: string; content?: unknown }>,
): string {
  const userTurns = messages
    .filter((m) => m.role === 'user')
    .map((m) => String(m.content ?? '').trim())
    .filter(Boolean)
  // Last 3 user turns so follow-ups like "in a pdf?" keep prior topic context.
  return userTurns.slice(-3).join('\n')
}

export async function planTurnCapabilities(opts: {
  messages: Array<{ role?: string; content?: unknown }>
}): Promise<TurnCapabilityPlan> {
  const route = await resolveAgentLlmRoute({ mock: isMockLlmEnabled() })
  const query = threadQueryFromMessages(opts.messages)
  const tools = await getToolsForTurn({
    query,
    toolsEnabled: route.toolsEnabled,
  })

  const allowPreLlmInterceptors =
    config.HERMES_ROUTING === 'legacy' || route.degraded || !route.toolsEnabled

  return { route, tools, allowPreLlmInterceptors }
}
