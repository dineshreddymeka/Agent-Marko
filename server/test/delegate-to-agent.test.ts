import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { EventType } from '@ag-ui/core'
import { HermesCustomEvents } from '@hermes/shared'
import {
  availableProviderIds,
  buildProviderCapabilityEntries,
  sanitizeProviderError,
  setAguiRemoteConfiguredCheckForTests,
  setProviderAvailabilityOverridesForTests,
  validateDelegationProvider,
} from '../src/agent/provider-capabilities'
import { getTool } from '../src/agent/tools/registry'
import '../src/agent/tools/delegate_to_agent'
import {
  listRecentDelegations,
  resetDelegationsForTests,
} from '../src/agui/runs'
import { ProviderError } from '../src/errors'
import { refreshCapabilityManifest } from '../src/capabilities'
import { handleCapabilities } from '../src/rest/capabilities'
import { registerProvider, type AgentProvider } from '../src/agent/provider'
import { nativeProvider } from '../src/agent/providers/native'

describe('provider capability manifest + delegation', () => {
  beforeEach(() => {
    setProviderAvailabilityOverridesForTests(null)
    setAguiRemoteConfiguredCheckForTests(null)
    resetDelegationsForTests()
  })

  afterEach(() => {
    setProviderAvailabilityOverridesForTests(null)
    setAguiRemoteConfiguredCheckForTests(null)
    resetDelegationsForTests()
    // Restore native in case a test swapped it
    registerProvider(nativeProvider)
  })

  test('buildProviderCapabilityEntries reflects availability overrides', async () => {
    setProviderAvailabilityOverridesForTests({
      native: true,
      'agui-remote': false,
      'hermes-python': false,
    })
    const entries = await buildProviderCapabilityEntries()
    expect(entries.map((e) => e.id)).toEqual(['native', 'agui-remote', 'hermes-python'])
    expect(entries.find((e) => e.id === 'native')?.available).toBe(true)
    expect(entries.find((e) => e.id === 'agui-remote')?.available).toBe(false)
    expect(entries.find((e) => e.id === 'hermes-python')?.status).toBe('misconfigured')
    expect(availableProviderIds(entries)).toEqual(['native'])
  })

  test('capability manifest includes providers[]', async () => {
    setProviderAvailabilityOverridesForTests({
      native: true,
      'agui-remote': true,
      'hermes-python': true,
    })
    const manifest = await refreshCapabilityManifest('test-providers')
    expect(Array.isArray(manifest.providers)).toBe(true)
    expect(manifest.providers.length).toBe(3)
    expect(manifest.providers.every((p) => typeof p.available === 'boolean')).toBe(true)

    const res = await handleCapabilities(
      new Request('http://127.0.0.1/api/capabilities'),
      '/api/capabilities',
    )
    expect(res).not.toBeNull()
    const body = (await res!.json()) as { providers: Array<{ id: string; available: boolean }> }
    expect(Array.isArray(body.providers)).toBe(true)
    expect(body.providers.length).toBe(3)
  })

  test('validateDelegationProvider rejects unsupported and unavailable ids', async () => {
    setProviderAvailabilityOverridesForTests({
      native: true,
      'agui-remote': false,
      'hermes-python': false,
    })

    const bad = await validateDelegationProvider('crewai')
    expect(bad.ok).toBe(false)
    if (!bad.ok) {
      expect(bad.result.code).toBe('PROVIDER_UNSUPPORTED')
      expect(bad.result.available).toContain('native')
    }

    const unavailable = await validateDelegationProvider('hermes-python')
    expect(unavailable.ok).toBe(false)
    if (!unavailable.ok) {
      expect(unavailable.result.code).toBe('PROVIDER_UNAVAILABLE')
    }

    const ok = await validateDelegationProvider('native')
    expect(ok.ok).toBe(true)
  })

  test('sanitizeProviderError redacts bearer tokens and truncates', () => {
    const safe = sanitizeProviderError(
      new ProviderError('Remote failed Authorization: Bearer super-secret-token-value and more'),
    )
    expect(safe.message).not.toContain('super-secret-token-value')
    expect(safe.message).toContain('[redacted]')
    expect(safe.code).toBe('PROVIDER_ERROR')
  })

  test('delegate_to_agent returns explicit unsupported-provider response', async () => {
    const tool = getTool('delegate_to_agent')
    expect(tool).toBeTruthy()
    const result = (await tool!.execute(
      { provider: 'not-a-provider', prompt: 'do a thing' },
      { sessionId: 's1', runId: 'r1', signal: new AbortController().signal },
    )) as { code?: string; error?: string; available?: string[] }

    expect(result.code).toBe('PROVIDER_UNSUPPORTED')
    expect(result.error).toMatch(/Unsupported provider/i)
    expect(Array.isArray(result.available)).toBe(true)
  })

  test('delegate_to_agent nests events and records parent-child observability', async () => {
    setProviderAvailabilityOverridesForTests({
      native: true,
      'agui-remote': false,
      'hermes-python': false,
    })

    const stub: AgentProvider = {
      id: 'native',
      async run(_input, emit) {
        await emit({
          type: EventType.TEXT_MESSAGE_CONTENT,
          messageId: 'm1',
          delta: 'nested-ok',
        } as never)
      },
    }
    registerProvider(stub)

    const emitted: Array<Record<string, unknown>> = []
    const tool = getTool('delegate_to_agent')!
    const result = (await tool.execute(
      { provider: 'native', prompt: 'summarize docs' },
      {
        sessionId: 'thread-1',
        runId: 'parent-run-1',
        signal: new AbortController().signal,
        emit: async (event) => {
          emitted.push(event as Record<string, unknown>)
        },
      },
    )) as { ok?: boolean; subRunId?: string; provider?: string; eventCount?: number }

    expect(result.ok).toBe(true)
    expect(result.provider).toBe('native')
    expect(result.subRunId).toBeTruthy()
    expect((result.eventCount ?? 0) > 0).toBe(true)

    const delegationStarted = emitted.find(
      (e) => e.name === HermesCustomEvents.DELEGATION && (e.value as { phase?: string })?.phase === 'started',
    )
    expect(delegationStarted).toBeTruthy()
    expect((delegationStarted!.value as { parentRunId: string }).parentRunId).toBe('parent-run-1')
    expect((delegationStarted!.value as { nestedRunId: string }).nestedRunId).toBe(result.subRunId)

    const nestedContent = emitted.find(
      (e) => e.type === EventType.TEXT_MESSAGE_CONTENT && e.parentRunId === 'parent-run-1',
    )
    expect(nestedContent).toBeTruthy()
    expect(nestedContent!.nestedRunId).toBe(result.subRunId)
    expect(nestedContent!.provider).toBe('native')

    const recent = listRecentDelegations()
    expect(recent.length).toBeGreaterThanOrEqual(1)
    expect(recent[0]!.parentRunId).toBe('parent-run-1')
    expect(recent[0]!.nestedRunId).toBe(result.subRunId)
    expect(recent[0]!.status).toBe('finished')
    expect(recent[0]!.provider).toBe('native')
  })

  test('delegate_to_agent emits safe RUN_ERROR on nested provider failure', async () => {
    setProviderAvailabilityOverridesForTests({ native: true })

    const stub: AgentProvider = {
      id: 'native',
      async run() {
        throw new ProviderError('boom Authorization: Bearer leak-me-please')
      },
    }
    registerProvider(stub)

    const emitted: Array<Record<string, unknown>> = []
    const tool = getTool('delegate_to_agent')!
    const result = (await tool.execute(
      { provider: 'native', prompt: 'fail please' },
      {
        sessionId: 'thread-2',
        runId: 'parent-run-2',
        signal: new AbortController().signal,
        emit: async (event) => {
          emitted.push(event as Record<string, unknown>)
        },
      },
    )) as { ok?: boolean; error?: string; code?: string; subRunId?: string }

    expect(result.ok).toBe(false)
    expect(result.code).toBe('PROVIDER_ERROR')
    expect(result.error).not.toContain('leak-me-please')
    expect(result.error).toContain('[redacted]')

    const runError = emitted.find((e) => e.type === EventType.RUN_ERROR)
    expect(runError).toBeTruthy()
    expect(String(runError!.message)).not.toContain('leak-me-please')

    const recent = listRecentDelegations()
    expect(recent[0]!.status).toBe('error')
    expect(recent[0]!.error).not.toContain('leak-me-please')
  })
})
