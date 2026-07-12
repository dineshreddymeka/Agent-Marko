/**
 * Agent LLM endpoint health + circuit breaker.
 * Tools are unavailable when the runtime falls back to the chat-only lm-bridge.
 */
import { config } from '../config'
import { logger } from '../log'
import type { AgentLlmRoute, CircuitState } from './types'

const BRIDGE_PORT_RE = /:3456(?:\/|$)/i

let circuitState: CircuitState = 'closed'
let consecutiveFailures = 0
let openedAt = 0
let lastFailure: string | null = null
let lastSuccessAt = 0
let lastHealthCheckAt = 0
let lastHealthOk = true

function isBridgeUrl(url: string): boolean {
  return BRIDGE_PORT_RE.test(url) || /lm-bridge/i.test(url)
}

export function isChatOnlyBridgeUrl(url: string): boolean {
  return isBridgeUrl(url)
}

/** Preferred tool-capable chat base URL (no trailing slash). */
export function preferredAgentBaseUrl(): string {
  const agent = (config.HERMES_AGENT_LLM_URL || '').trim()
  if (agent) return agent.replace(/\/$/, '')
  const base = config.LLM_BASE_URL.replace(/\/$/, '')
  if (!isBridgeUrl(base)) return base
  return ''
}

export function bridgeFallbackBaseUrl(): string {
  const base = config.LLM_BASE_URL.replace(/\/$/, '')
  if (isBridgeUrl(base)) return base
  return 'http://127.0.0.1:3456/v1'
}

function openTtlMs(): number {
  const n = Math.min(consecutiveFailures, 5)
  return Math.min(5_000 * 2 ** Math.max(0, n - 1), 60_000)
}

async function probeAgentEndpoint(baseUrl: string): Promise<boolean> {
  const timeoutMs = config.HERMES_AGENT_LLM_TIMEOUT_MS
  const signal = AbortSignal.timeout(timeoutMs)
  const url = `${baseUrl.replace(/\/$/, '')}/models`
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: config.LLM_API_KEY ? `Bearer ${config.LLM_API_KEY}` : '',
      },
      signal,
    })
    if (res.status === 404) return true
    return res.ok || res.status === 401 || res.status === 403
  } catch (err) {
    lastFailure = err instanceof Error ? err.message : String(err)
    return false
  }
}

export async function ensureAgentHealth(): Promise<boolean> {
  const agentUrl = preferredAgentBaseUrl()
  if (!agentUrl) {
    lastHealthOk = false
    lastFailure = lastFailure ?? 'HERMES_AGENT_LLM_URL unset while LLM_BASE_URL is chat-only bridge'
    return false
  }

  const now = Date.now()
  if (circuitState === 'open') {
    if (now - openedAt < openTtlMs()) return false
    circuitState = 'half_open'
  }

  if (circuitState === 'closed' && lastHealthOk && now - lastHealthCheckAt < 30_000) {
    return true
  }

  lastHealthCheckAt = now
  const ok = await probeAgentEndpoint(agentUrl)
  if (ok) {
    consecutiveFailures = 0
    circuitState = 'closed'
    lastHealthOk = true
    lastSuccessAt = now
    lastFailure = null
    return true
  }

  consecutiveFailures += 1
  lastHealthOk = false
  if (circuitState === 'half_open' || consecutiveFailures >= 3) {
    circuitState = 'open'
    openedAt = now
    logger.warn('Agent LLM circuit open', {
      consecutiveFailures,
      lastFailure,
      openForMs: openTtlMs(),
    })
  }
  return false
}

export function recordAgentLlmFailure(err: unknown, aborted: boolean): void {
  if (aborted) return
  consecutiveFailures += 1
  lastFailure = err instanceof Error ? err.message : String(err)
  lastHealthOk = false
  if (consecutiveFailures >= 3) {
    circuitState = 'open'
    openedAt = Date.now()
  }
}

export function recordAgentLlmSuccess(): void {
  consecutiveFailures = 0
  circuitState = 'closed'
  lastHealthOk = true
  lastSuccessAt = Date.now()
  lastFailure = null
}

export async function resolveAgentLlmRoute(opts?: {
  mock?: boolean
}): Promise<AgentLlmRoute> {
  if (opts?.mock) {
    return {
      baseUrl: config.LLM_BASE_URL.replace(/\/$/, ''),
      toolsEnabled: true,
      degraded: false,
      reason: 'mock',
      circuitState: 'closed',
      lastFailure: null,
    }
  }

  if (config.HERMES_ROUTING === 'legacy') {
    const base = config.LLM_BASE_URL.replace(/\/$/, '')
    const bridge = isBridgeUrl(base)
    return {
      baseUrl: base,
      toolsEnabled: !bridge,
      degraded: bridge,
      reason: bridge ? 'bridge_fallback' : 'legacy',
      circuitState,
      lastFailure,
    }
  }

  const agentUrl = preferredAgentBaseUrl()
  if (agentUrl) {
    const healthy = await ensureAgentHealth()
    if (healthy) {
      return {
        baseUrl: agentUrl,
        toolsEnabled: true,
        degraded: false,
        reason: 'agent',
        circuitState,
        lastFailure: null,
      }
    }
  }

  const bridge = bridgeFallbackBaseUrl()
  return {
    baseUrl: bridge,
    toolsEnabled: false,
    degraded: true,
    reason: 'bridge_fallback',
    circuitState,
    lastFailure:
      lastFailure ??
      (agentUrl ? 'agent endpoint unhealthy' : 'no tool-capable HERMES_AGENT_LLM_URL configured'),
  }
}

export function getAgentLlmHealthSnapshot() {
  const preferred = preferredAgentBaseUrl() || null
  const degraded =
    circuitState === 'open' ||
    (config.HERMES_ROUTING === 'capabilities' && !preferred) ||
    (lastHealthCheckAt > 0 && !lastHealthOk)
  return {
    preferredAgentBaseUrl: preferred,
    bridgeFallbackBaseUrl: bridgeFallbackBaseUrl(),
    circuitState,
    consecutiveFailures,
    lastFailure,
    lastSuccessAt: lastSuccessAt ? new Date(lastSuccessAt).toISOString() : null,
    lastHealthCheckAt: lastHealthCheckAt ? new Date(lastHealthCheckAt).toISOString() : null,
    lastHealthOk,
    routing: config.HERMES_ROUTING,
    timeoutMs: config.HERMES_AGENT_LLM_TIMEOUT_MS,
    degraded,
    toolsEnabled: !degraded,
  }
}

/** Probe preferred agent endpoint (if any) and return a fresh health snapshot. */
export async function probeAgentLlmHealth() {
  await ensureAgentHealth()
  return getAgentLlmHealthSnapshot()
}

/** Test-only: reset circuit breaker / probe state between cases. */
export function resetAgentLlmHealthForTests(): void {
  circuitState = 'closed'
  consecutiveFailures = 0
  openedAt = 0
  lastFailure = null
  lastSuccessAt = 0
  lastHealthCheckAt = 0
  lastHealthOk = true
}
