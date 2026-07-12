import { describe, expect, test, beforeAll } from 'bun:test'
import '../src/agent/tools/files'
import '../src/agent/tools/web'
import '../src/agent/tools/memory'
import '../src/agent/tools/skills'
import '../src/agent/tools/a2ui'
import '../src/agent/tools/delegate_to_cowork'
import '../src/agent/tools/index_search'
import { handleCapabilities } from '../src/rest/capabilities'
import {
  refreshCapabilityManifest,
  resetAgentLlmHealthForTests,
  setCachedDescriptionVector,
} from '../src/capabilities'

describe('capabilities REST staging gates', () => {
  beforeAll(async () => {
    resetAgentLlmHealthForTests()
    const manifest = await refreshCapabilityManifest('test-rest')
    for (const t of manifest.tools) {
      setCachedDescriptionVector(t.name, t.description, null)
    }
  })

  test('GET /api/capabilities returns manifest + agentLlm degraded/toolsEnabled', async () => {
    const res = await handleCapabilities(
      new Request('http://127.0.0.1/api/capabilities'),
      '/api/capabilities',
    )
    expect(res).not.toBeNull()
    expect(res!.status).toBe(200)
    const body = (await res!.json()) as {
      tools: unknown[]
      slashCommands: unknown[]
      routing: string
      agentLlm: {
        degraded: boolean
        toolsEnabled: boolean
        routing: string
        timeoutMs: number
      }
    }
    expect(Array.isArray(body.tools)).toBe(true)
    expect(Array.isArray(body.slashCommands)).toBe(true)
    expect(body.agentLlm).toBeTruthy()
    expect(typeof body.agentLlm.degraded).toBe('boolean')
    expect(body.agentLlm.toolsEnabled).toBe(!body.agentLlm.degraded)
    expect(body.agentLlm.timeoutMs).toBeGreaterThan(0)
  })

  test('POST /api/capabilities/warm returns mcpReconnect + agentLlm + slashCommands', async () => {
    const res = await handleCapabilities(
      new Request('http://127.0.0.1/api/capabilities/warm', { method: 'POST' }),
      '/api/capabilities/warm',
    )
    expect(res).not.toBeNull()
    expect(res!.status).toBe(200)
    const body = (await res!.json()) as {
      ok: boolean
      tools: number
      skills: number
      plugins: number
      slashCommands: number
      mcpReconnect: { ok: boolean; error: string | null }
      agentLlm: { degraded: boolean; toolsEnabled: boolean }
      refreshedAt: string
    }
    expect(body.ok).toBe(true)
    expect(typeof body.tools).toBe('number')
    expect(typeof body.slashCommands).toBe('number')
    expect(body.mcpReconnect).toBeTruthy()
    expect(typeof body.mcpReconnect.ok).toBe('boolean')
    expect(body.agentLlm).toBeTruthy()
    expect(typeof body.agentLlm.degraded).toBe('boolean')
    expect(body.agentLlm.toolsEnabled).toBe(!body.agentLlm.degraded)
    expect(body.refreshedAt).toBeTruthy()
  })
})
