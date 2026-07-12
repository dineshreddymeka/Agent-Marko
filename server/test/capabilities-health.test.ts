import { describe, expect, test, beforeEach } from 'bun:test'
import {
  getAgentLlmHealthSnapshot,
  isChatOnlyBridgeUrl,
  preferredAgentBaseUrl,
  recordAgentLlmFailure,
  recordAgentLlmSuccess,
  resetAgentLlmHealthForTests,
  resolveAgentLlmRoute,
} from '../src/capabilities'
import { config } from '../src/config'

describe('agent LLM health / staging telemetry', () => {
  beforeEach(() => {
    resetAgentLlmHealthForTests()
  })

  test('isChatOnlyBridgeUrl detects lm-bridge ports and labels', () => {
    expect(isChatOnlyBridgeUrl('http://127.0.0.1:3456/v1')).toBe(true)
    expect(isChatOnlyBridgeUrl('http://localhost:3456')).toBe(true)
    expect(isChatOnlyBridgeUrl('http://lm-bridge.internal/v1')).toBe(true)
    expect(isChatOnlyBridgeUrl('https://api.openai.com/v1')).toBe(false)
  })

  test('preferredAgentBaseUrl skips chat-only bridge LLM_BASE_URL', () => {
    const preferred = preferredAgentBaseUrl()
    if ((config.HERMES_AGENT_LLM_URL || '').trim()) {
      expect(preferred).toBe(config.HERMES_AGENT_LLM_URL.replace(/\/$/, ''))
    } else if (isChatOnlyBridgeUrl(config.LLM_BASE_URL)) {
      expect(preferred).toBe('')
    } else {
      expect(preferred).toBe(config.LLM_BASE_URL.replace(/\/$/, ''))
    }
  })

  test('snapshot reports degraded when capabilities routing has no tool-capable URL', () => {
    const snap = getAgentLlmHealthSnapshot()
    expect(snap.routing).toBe(config.HERMES_ROUTING)
    expect(typeof snap.degraded).toBe('boolean')
    expect(typeof snap.toolsEnabled).toBe('boolean')
    expect(snap.toolsEnabled).toBe(!snap.degraded)
    expect(snap.timeoutMs).toBe(config.HERMES_AGENT_LLM_TIMEOUT_MS)
    if (config.HERMES_ROUTING === 'capabilities' && !preferredAgentBaseUrl()) {
      expect(snap.degraded).toBe(true)
      expect(snap.preferredAgentBaseUrl).toBeNull()
    }
  })

  test('three failures open the circuit and mark degraded', () => {
    recordAgentLlmFailure(new Error('probe timeout'), false)
    recordAgentLlmFailure(new Error('probe timeout'), false)
    expect(getAgentLlmHealthSnapshot().circuitState).not.toBe('open')
    recordAgentLlmFailure(new Error('probe timeout'), false)
    const snap = getAgentLlmHealthSnapshot()
    expect(snap.circuitState).toBe('open')
    expect(snap.degraded).toBe(true)
    expect(snap.toolsEnabled).toBe(false)
    expect(snap.lastFailure).toContain('probe timeout')
    expect(snap.consecutiveFailures).toBeGreaterThanOrEqual(3)
  })

  test('aborted failures do not trip the circuit', () => {
    recordAgentLlmFailure(new Error('aborted'), true)
    recordAgentLlmFailure(new Error('aborted'), true)
    recordAgentLlmFailure(new Error('aborted'), true)
    expect(getAgentLlmHealthSnapshot().circuitState).toBe('closed')
    expect(getAgentLlmHealthSnapshot().consecutiveFailures).toBe(0)
  })

  test('success clears open circuit telemetry', () => {
    recordAgentLlmFailure(new Error('down'), false)
    recordAgentLlmFailure(new Error('down'), false)
    recordAgentLlmFailure(new Error('down'), false)
    expect(getAgentLlmHealthSnapshot().circuitState).toBe('open')
    recordAgentLlmSuccess()
    const snap = getAgentLlmHealthSnapshot()
    expect(snap.circuitState).toBe('closed')
    expect(snap.lastFailure).toBeNull()
    expect(snap.consecutiveFailures).toBe(0)
    expect(snap.lastSuccessAt).toBeTruthy()
  })

  test('mock route stays tools-enabled and not degraded', async () => {
    const route = await resolveAgentLlmRoute({ mock: true })
    expect(route.degraded).toBe(false)
    expect(route.toolsEnabled).toBe(true)
    expect(route.reason).toBe('mock')
  })
})
