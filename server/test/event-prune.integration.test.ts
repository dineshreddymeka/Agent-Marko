/**
 * Event-log retention prune — cutoff behavior (integration when DB available).
 * Requires HERMES_INTEGRATION_TEST=1 and local Postgres on :5433.
 * Author: Dinesh Reddy Meka
 */
import { afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { isIntegrationEnabled, prepareIntegrationDb, truncateAppTables } from './helpers/db'
import { getSql } from '../src/db/client'
import { runEventsRepo } from '../src/db/repositories/run_events'
import { mcpServersRepo } from '../src/db/repositories/mcp_servers'

const enabled = await isIntegrationEnabled()

describe.skipIf(!enabled)('event retention prune (integration)', () => {
  beforeAll(async () => {
    await prepareIntegrationDb()
  })

  afterEach(async () => {
    await truncateAppTables()
  })

  test('runEventsRepo.pruneOlderThan deletes past cutoff and keeps recent', async () => {
    const sql = getSql()
    const runId = crypto.randomUUID()
    const oldId = crypto.randomUUID()
    const recentId = crypto.randomUUID()

    await sql`
      INSERT INTO run_events (id, run_id, seq, event_type, payload, created_at)
      VALUES
        (${oldId}::uuid, ${runId}::uuid, 1, 'RUN_STARTED', '{}'::jsonb, now() - interval '40 days'),
        (${recentId}::uuid, ${runId}::uuid, 2, 'TEXT_MESSAGE_CONTENT', '{}'::jsonb, now() - interval '5 days')
    `

    const deleted = await runEventsRepo.pruneOlderThan(30)
    expect(deleted).toBe(1)

    const remaining = await runEventsRepo.listByRun(runId)
    expect(remaining).toHaveLength(1)
    expect(remaining[0]!.id).toBe(recentId)
  })

  test('mcpServersRepo.pruneConnectionEventsOlderThan respects cutoff', async () => {
    const sql = getSql()
    const server = await mcpServersRepo.create({
      name: `prune-mcp-${Date.now()}`,
      transport: 'http',
      url: 'http://localhost:9999/mcp',
      enabled: true,
    })

    const oldId = crypto.randomUUID()
    const recentId = crypto.randomUUID()
    await sql`
      INSERT INTO mcp_connection_events (id, server_id, event_type, status, created_at)
      VALUES
        (${oldId}::uuid, ${server.id}::uuid, 'connected', 'connected', now() - interval '45 days'),
        (${recentId}::uuid, ${server.id}::uuid, 'connected', 'connected', now() - interval '2 days')
    `

    const deleted = await mcpServersRepo.pruneConnectionEventsOlderThan(30)
    expect(deleted).toBe(1)

    const events = await mcpServersRepo.listEvents(server.id, 50)
    expect(events).toHaveLength(1)
    expect(events[0]!.id).toBe(recentId)
  })
})

describe('event retention prune (unit)', () => {
  test('prune methods reject invalid days without hitting DB', async () => {
    await expect(runEventsRepo.pruneOlderThan(0)).rejects.toThrow(/days must be >= 1/)
    await expect(mcpServersRepo.pruneConnectionEventsOlderThan(-1)).rejects.toThrow(/days must be >= 1/)
  })

  test('HERMES_*_EVENT_RETENTION_DAYS default to 30', async () => {
    const prevRun = process.env.HERMES_EVENT_RETENTION_DAYS
    const prevMcp = process.env.HERMES_MCP_EVENT_RETENTION_DAYS
    delete process.env.HERMES_EVENT_RETENTION_DAYS
    delete process.env.HERMES_MCP_EVENT_RETENTION_DAYS
    const { loadConfig } = await import('../src/config')
    const cfg = loadConfig()
    expect(cfg.HERMES_EVENT_RETENTION_DAYS).toBe(30)
    expect(cfg.HERMES_MCP_EVENT_RETENTION_DAYS).toBe(30)
    if (prevRun !== undefined) process.env.HERMES_EVENT_RETENTION_DAYS = prevRun
    else delete process.env.HERMES_EVENT_RETENTION_DAYS
    if (prevMcp !== undefined) process.env.HERMES_MCP_EVENT_RETENTION_DAYS = prevMcp
    else delete process.env.HERMES_MCP_EVENT_RETENTION_DAYS
  })
})
