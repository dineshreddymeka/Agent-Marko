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

  test('sessions.ensure is idempotent and enables message FK', async () => {
    const id = crypto.randomUUID()
    const first = await sessionsRepo.ensure(id, 'Ensured chat')
    expect(first.id).toBe(id)
    const second = await sessionsRepo.ensure(id, 'Ignored title')
    expect(second.id).toBe(id)
    expect(second.title).toBe('Ensured chat')

    await messagesRepo.create({
      sessionId: id,
      role: 'user',
      content: 'persist-me',
    })
    await messagesRepo.create({
      sessionId: id,
      role: 'assistant',
      content: 'persisted-reply',
    })
    const listed = await messagesRepo.listBySession(id)
    expect(listed.map((m) => m.role)).toEqual(['user', 'assistant'])
    expect(listed.map((m) => m.content)).toEqual(['persist-me', 'persisted-reply'])
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

  test('expected indexes exist after migrations', async () => {
    const sql = getSql()
    const rows = await sql`
      SELECT indexname FROM pg_indexes
      WHERE schemaname = 'public'
      ORDER BY indexname
    `
    const names = rows.map((r: { indexname: string }) => r.indexname)

    const expected = [
      'messages_search_gin',
      'messages_session_created_idx',
      'sessions_updated_at_idx',
      'messages_embedding_hnsw',
      'memory_embedding_hnsw',
      'skills_embedding_hnsw',
      'run_events_run_seq_key',
      'cron_jobs_next_run_idx',
      'cron_runs_job_started_idx',
      'memory_kind_idx',
      'messages_run_id_idx',
      'sessions_profile_id_idx',
      'run_events_session_id_idx',
    ]
    for (const idx of expected) {
      expect(names).toContain(idx)
    }
    expect(names).not.toContain('run_events_run_seq_idx')
    expect(names).not.toContain('api_tokens_hash_idx')
  })

  test('0006 integrity constraints and foreign keys exist', async () => {
    const sql = getSql()
    const rows = await sql`
      SELECT conname, contype
      FROM pg_constraint
      WHERE conrelid::regclass::text IN (
        'sessions', 'cron_jobs', 'memory', 'cron_runs', 'run_events',
        'messages', 'mcp_servers'
      )
      ORDER BY conname
    `
    const names = rows.map((r: { conname: string }) => r.conname)

    for (const fk of [
      'sessions_profile_fk',
      'cron_jobs_profile_fk',
      'memory_source_session_fk',
      'cron_runs_session_fk',
      'run_events_session_fk',
    ]) {
      expect(names).toContain(fk)
    }

    for (const check of [
      'messages_role_check',
      'cron_runs_status_check',
      'mcp_servers_transport_check',
    ]) {
      expect(names).toContain(check)
    }

    const cols = await sql`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND (
          (table_name = 'cron_jobs' AND column_name = 'created_at')
          OR (table_name = 'profiles' AND column_name IN ('created_at', 'updated_at', 'session_id'))
          OR (table_name = 'settings' AND column_name IN ('created_at', 'updated_at', 'session_id'))
          OR (table_name = 'skills' AND column_name = 'session_id')
          OR (table_name = 'mcp_servers' AND column_name = 'session_id')
          OR (table_name = 'api_tokens' AND column_name = 'session_id')
        )
      ORDER BY table_name, column_name
    `
    const colKeys = cols.map(
      (r: { table_name: string; column_name: string }) => `${r.table_name}.${r.column_name}`,
    )
    expect(colKeys).toContain('cron_jobs.created_at')
    expect(colKeys).toContain('profiles.created_at')
    expect(colKeys).toContain('profiles.updated_at')
    expect(colKeys).toContain('profiles.session_id')
    expect(colKeys).toContain('settings.created_at')
    expect(colKeys).toContain('settings.updated_at')
    expect(colKeys).toContain('settings.session_id')
    expect(colKeys).toContain('skills.session_id')
    expect(colKeys).toContain('mcp_servers.session_id')
    expect(colKeys).toContain('api_tokens.session_id')
  })

  test('cron_runs.status check accepts runtime values and rejects invalid', async () => {
    const sql = getSql()
    const [job] = await sql`
      INSERT INTO cron_jobs (name, schedule, prompt)
      VALUES ('status-check', '0 * * * *', 'ping')
      RETURNING id
    `
    const jobId = (job as { id: string }).id

    for (const status of ['running', 'completed', 'failed'] as const) {
      await sql`
        INSERT INTO cron_runs (job_id, status)
        VALUES (${jobId}::uuid, ${status})
      `
    }

    let rejected = false
    try {
      await sql`
        INSERT INTO cron_runs (job_id, status)
        VALUES (${jobId}::uuid, 'success')
      `
    } catch {
      rejected = true
    }
    expect(rejected).toBe(true)
  })

  test('run_events (run_id, seq) uniqueness is enforced', async () => {
    const sql = getSql()
    const runId = crypto.randomUUID()
    await sql`
      INSERT INTO run_events (run_id, seq, event_type, payload)
      VALUES (${runId}::uuid, 1, 'RUN_STARTED', '{}'::jsonb)
    `
    let rejected = false
    try {
      await sql`
        INSERT INTO run_events (run_id, seq, event_type, payload)
        VALUES (${runId}::uuid, 1, 'RUN_FINISHED', '{}'::jsonb)
      `
    } catch {
      rejected = true
    }
    expect(rejected).toBe(true)
  })

  test('migration tracking table records migration files including 0006', async () => {
    const sql = getSql()
    const rows = await sql`
      SELECT name FROM _hermes_migrations ORDER BY name
    `
    const names = rows.map((r: { name: string }) => r.name)
    expect(names).toContain('0001_init.sql')
    expect(names).toContain('0002_perf_indexes.sql')
    expect(names).toContain('0006_integrity_fixes.sql')
    expect(names).toContain('0007_skills_sync.sql')
  })
})
