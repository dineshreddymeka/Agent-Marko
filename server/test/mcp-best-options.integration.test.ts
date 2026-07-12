/**
 * Best-options MCP create path — persists to mcp_servers + connection events.
 * Requires HERMES_INTEGRATION_TEST=1 and local Postgres on :5433.
 * Author: Dinesh Reddy Meka
 */
import { afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { isIntegrationEnabled, prepareIntegrationDb, truncateAppTables } from './helpers/db'
import { mcpServersRepo } from '../src/db/repositories/mcp_servers'
import { handleMcp } from '../src/rest/mcp'
import { disconnectAll } from '../src/mcp/manager'

const enabled = await isIntegrationEnabled()

/** Mirrors app Best options chrome-mock URL (mock-mcp-chrome.ts default). */
const CHROME_MOCK_URL = 'http://127.0.0.1:3922/mcp'

describe.skipIf(!enabled)('MCP Best options create (integration)', () => {
  beforeAll(async () => {
    await prepareIntegrationDb()
  })

  afterEach(async () => {
    await disconnectAll()
    await truncateAppTables()
  })

  test('POST create persists metadata and records a connection event', async () => {
    const req = new Request('http://localhost/api/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'chrome-mock',
        description: 'Chrome research (mock)',
        transport: 'http',
        url: CHROME_MOCK_URL,
        enabled: true,
        httpPreferSse: false,
        timeoutMs: 5_000,
        autoReconnect: false,
        metadata: {
          presetId: 'chrome-mock',
          presetBadge: 'Recommended',
          source: 'best-options',
        },
      }),
    })

    const res = await handleMcp(req, '/api/mcp')
    expect(res).not.toBeNull()
    expect(res!.status).toBe(201)
    const body = (await res!.json()) as {
      id: string
      name: string
      url: string
      metadata: Record<string, unknown> | null
      lastStatus: string | null
    }
    expect(body.name).toBe('chrome-mock')
    expect(body.url).toBe(CHROME_MOCK_URL)
    expect(body.metadata?.source).toBe('best-options')
    expect(body.metadata?.presetId).toBe('chrome-mock')

    const listed = await mcpServersRepo.list()
    expect(listed.some((s) => s.id === body.id)).toBe(true)

    const events = await mcpServersRepo.listEvents(body.id, 20)
    expect(events.length).toBeGreaterThan(0)
  })

  test('duplicate Best option name returns 409', async () => {
    const name = `best-opt-${crypto.randomUUID()}`
    const payload = {
      name,
      transport: 'stdio' as const,
      command: 'npx -y @modelcontextprotocol/server-filesystem .',
      enabled: false,
      autoReconnect: false,
      metadata: { source: 'best-options', presetId: 'filesystem' },
    }

    const first = await handleMcp(
      new Request('http://localhost/api/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }),
      '/api/mcp',
    )
    expect(first!.status).toBe(201)

    const second = await handleMcp(
      new Request('http://localhost/api/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }),
      '/api/mcp',
    )
    expect(second!.status).toBe(409)
  })
})

describe('MCP Best options port contract (unit)', () => {
  test('chrome mock default port is 3922', () => {
    expect(CHROME_MOCK_URL).toBe('http://127.0.0.1:3922/mcp')
  })
})
