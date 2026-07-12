/**
 * Cowork + Postgres integrity — sessions/run_events audits under 0006 constraints.
 * Requires HERMES_INTEGRATION_TEST=1 and local Postgres 17 on :5433.
 */
import { afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { isIntegrationEnabled, prepareIntegrationDb, truncateAppTables } from './helpers/db'
import { getSql } from '../src/db/client'
import { sessionsRepo } from '../src/db/repositories/sessions'
import { runEventsRepo } from '../src/db/repositories/run_events'
import {
  coworkSessionTitle,
  persistCoworkAudit,
} from '../src/cowork/persist'

const enabled = await isIntegrationEnabled()

describe.skipIf(!enabled)('cowork database integration (0006 + audit persist)', () => {
  beforeAll(async () => {
    await prepareIntegrationDb()
  })

  afterEach(async () => {
    await truncateAppTables()
  })

  test('0006: cron_runs.status accepts completed/failed', async () => {
    const sql = getSql()
    const [job] = await sql`
      INSERT INTO cron_jobs (name, schedule, prompt)
      VALUES ('cowork-status-check', '0 * * * *', 'ping')
      RETURNING id
    `
    const jobId = (job as { id: string }).id

    for (const status of ['completed', 'failed'] as const) {
      await sql`
        INSERT INTO cron_runs (job_id, status)
        VALUES (${jobId}::uuid, ${status})
      `
    }

    const rows = await sql`
      SELECT status FROM cron_runs WHERE job_id = ${jobId}::uuid ORDER BY status
    `
    expect(rows.map((r: { status: string }) => r.status)).toEqual(['completed', 'failed'])
  })

  test('0006: run_events (run_id, seq) uniqueness is enforced', async () => {
    const sql = getSql()
    const runId = crypto.randomUUID()
    await sql`
      INSERT INTO run_events (run_id, seq, event_type, payload)
      VALUES (${runId}::uuid, 1, 'COWORK_STARTED', '{}'::jsonb)
    `
    let rejected = false
    try {
      await sql`
        INSERT INTO run_events (run_id, seq, event_type, payload)
        VALUES (${runId}::uuid, 1, 'COWORK_FINISHED', '{}'::jsonb)
      `
    } catch {
      rejected = true
    }
    expect(rejected).toBe(true)
  })

  test('persistCoworkAudit creates Cowork session and appends run_events without breaking FKs', async () => {
    const taskId = 't-20260711-001'
    const result = await persistCoworkAudit({
      taskId,
      ok: true,
      status: 'done',
      events: [
        { type: 'agent.text_delta', text: 'working…' },
        { type: 'tool.call', tool: 'read_file', input: { path: 'brief.md' } },
      ],
      meta: {
        source: 'integration-test',
        goal: 'Write a brief',
        deliverableType: 'pdf',
        inputFiles: [],
      },
    })

    expect(result.eventCount).toBe(4)
    expect(coworkSessionTitle(taskId)).toBe(`Cowork: ${taskId}`)

    const session = await sessionsRepo.getById(result.sessionId)
    expect(session).not.toBeNull()
    expect(session!.title).toBe(`Cowork: ${taskId}`)

    const events = await runEventsRepo.listByRun(result.runId)
    expect(events).toHaveLength(4)
    expect(events.map((e) => e.eventType)).toEqual([
      'COWORK_STARTED',
      'agent.text_delta',
      'tool.call',
      'COWORK_FINISHED',
    ])
    for (const e of events) {
      expect(e.sessionId).toBe(result.sessionId)
      expect(e.runId).toBe(result.runId)
      expect(typeof e.createdAt).toBe('string')
      expect(e.payload).toBeTruthy()
    }

    const started = events[0]!.payload as Record<string, unknown>
    expect(started.goal).toBe('Write a brief')
    expect(started.deliverableType).toBe('pdf')
    const finished = events[3]!.payload as Record<string, unknown>
    expect(finished.status).toBe('done')

    const sql = getSql()
    const fkOk = await sql`
      SELECT re.id
      FROM run_events re
      INNER JOIN sessions s ON s.id = re.session_id
      WHERE re.run_id = ${result.runId}::uuid
    `
    expect(fkOk).toHaveLength(4)
  })

  test('listBySession restores cowork payloads after restart shape', async () => {
    const { beginCoworkAudit, finishCoworkAudit, restoreCoworkTaskFromEvents } =
      await import('../src/cowork/persist')
    const taskId = 't-20260712-restore'
    const begun = await beginCoworkAudit({
      taskId,
      meta: { goal: 'Restore me', deliverableType: 'word', inputFiles: [] },
    })
    await finishCoworkAudit({
      sessionId: begun.sessionId,
      runId: begun.runId,
      taskId,
      ok: true,
      status: 'done',
      meta: { files: [`outbox/${taskId}/doc.docx`], summary: 'ok' },
    })

    const events = await runEventsRepo.listBySession(begun.sessionId)
    const restored = restoreCoworkTaskFromEvents(taskId, begun.sessionId, events)
    expect(restored.goal).toBe('Restore me')
    expect(restored.deliverableType).toBe('word')
    expect(restored.status).toBe('done')
    expect(restored.files).toEqual([`outbox/${taskId}/doc.docx`])
  })

  test('simulated cowork run: session title + sequential run_events stay unique', async () => {
    const taskId = 't-20260711-002'
    const runId = crypto.randomUUID()
    const session = await sessionsRepo.create({ title: coworkSessionTitle(taskId) })

    await runEventsRepo.append({
      runId,
      sessionId: session.id,
      seq: 1,
      eventType: 'COWORK_STARTED',
      payload: { taskId },
    })
    await runEventsRepo.append({
      runId,
      sessionId: session.id,
      seq: 2,
      eventType: 'COWORK_FINISHED',
      payload: { taskId, ok: false },
    })

    const listed = await runEventsRepo.listByRun(runId)
    expect(listed).toHaveLength(2)
    expect(listed[0]!.seq).toBe(1)
    expect(listed[1]!.seq).toBe(2)

    let duplicateRejected = false
    try {
      await runEventsRepo.append({
        runId,
        sessionId: session.id,
        seq: 1,
        eventType: 'COWORK_STARTED',
        payload: { taskId, dup: true },
      })
    } catch {
      duplicateRejected = true
    }
    expect(duplicateRejected).toBe(true)
  })
})
