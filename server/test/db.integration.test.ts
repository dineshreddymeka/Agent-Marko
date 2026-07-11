import { afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { isIntegrationEnabled, prepareIntegrationDb, truncateAppTables } from './helpers/db'
import { sessionsRepo } from '../src/db/repositories/sessions'
import { messagesRepo } from '../src/db/repositories/messages'
import { settingsRepo } from '../src/db/repositories/settings'
import { memoryRepo } from '../src/db/repositories/memory'
import { getSql } from '../src/db/client'

const enabled = await isIntegrationEnabled()

describe.skipIf(!enabled)('database integration (Postgres 17 + pgvector)', () => {
  beforeAll(async () => {
    await prepareIntegrationDb()
  })

  afterEach(async () => {
    await truncateAppTables()
  })

  test('pgvector extension is installed', async () => {
    const sql = getSql()
    const rows = await sql`
      SELECT extname FROM pg_extension WHERE extname = 'vector'
    `
    expect(rows.length).toBe(1)
  })

  test('sessions CRUD', async () => {
    const created = await sessionsRepo.create({ title: 'Integration test' })
    expect(created.title).toBe('Integration test')

    const listed = await sessionsRepo.list()
    expect(listed.some((s) => s.id === created.id)).toBe(true)

    const updated = await sessionsRepo.update(created.id, { title: 'Updated' })
    expect(updated?.title).toBe('Updated')

    expect(await sessionsRepo.delete(created.id)).toBe(true)
    expect(await sessionsRepo.getById(created.id)).toBeNull()
  })

  test('messages persist for a session', async () => {
    const session = await sessionsRepo.create({ title: 'Chat' })
    const msg = await messagesRepo.create({
      sessionId: session.id,
      role: 'user',
      content: 'Hello Hermes',
    })
    const listed = await messagesRepo.listBySession(session.id)
    expect(listed).toHaveLength(1)
    expect(listed[0]!.id).toBe(msg.id)
    expect(listed[0]!.content).toBe('Hello Hermes')
  })

  test('settings upsert', async () => {
    await settingsRepo.set('theme', { mode: 'dark' })
    expect(await settingsRepo.get('theme')).toEqual({ mode: 'dark' })
    await settingsRepo.set('theme', { mode: 'dim' })
    expect(await settingsRepo.get('theme')).toEqual({ mode: 'dim' })
  })

  test('memory entries with vector column accept null embedding', async () => {
    const entry = await memoryRepo.create({
      kind: 'semantic',
      content: 'User prefers Postgres 17',
      importance: 0.9,
    })
    expect(entry.content).toContain('Postgres 17')
    const listed = await memoryRepo.list({ kind: 'semantic' })
    expect(listed.some((m) => m.id === entry.id)).toBe(true)
  })
})
