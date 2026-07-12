import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { CoworkClient } from '../src/cowork/client'
import {
  getCoworkTaskRecord,
  resetCoworkTaskStateForTests,
} from '../src/cowork/run-task'
import { handleCowork } from '../src/rest/cowork'
import { createMockCoworkSpawn } from './helpers/mock-cowork-child'

// Route exercises startCoworkTaskAsync which uses config OPEN_COWORK_WORKSPACE.
// Inject via createClient is only on startCoworkTaskAsync input — REST does not
// pass createClient. So we test handler validation + abort/list against memory,
// and run packaging path separately in cowork-run-task.test.ts.

describe('handleCowork REST', () => {
  afterEach(() => {
    resetCoworkTaskStateForTests()
  })

  test('POST /api/cowork/tasks rejects missing goal', async () => {
    const res = await handleCowork(
      new Request('http://localhost/api/cowork/tasks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ deliverableType: 'pdf' }),
      }),
      '/api/cowork/tasks',
    )
    expect(res).not.toBeNull()
    expect(res!.status).toBe(400)
    const body = (await res!.json()) as { error: string }
    expect(body.error).toContain('goal')
  })

  test('POST /api/cowork/tasks rejects invalid deliverableType', async () => {
    const res = await handleCowork(
      new Request('http://localhost/api/cowork/tasks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ goal: 'x', deliverableType: 'movie' }),
      }),
      '/api/cowork/tasks',
    )
    expect(res).not.toBeNull()
    expect(res!.status).toBe(400)
  })

  test('GET list + abort 409 when no active client', async () => {
    const list = await handleCowork(
      new Request('http://localhost/api/cowork/tasks'),
      '/api/cowork/tasks',
    )
    expect(list).not.toBeNull()
    expect(list!.status).toBe(200)
    const listBody = (await list!.json()) as { tasks: unknown[] }
    expect(Array.isArray(listBody.tasks)).toBe(true)

    const abort = await handleCowork(
      new Request('http://localhost/api/cowork/tasks/t-missing/abort', {
        method: 'POST',
      }),
      '/api/cowork/tasks/t-missing/abort',
    )
    expect(abort).not.toBeNull()
    expect(abort!.status).toBe(409)
    const abortBody = (await abort!.json()) as { ok: boolean }
    expect(abortBody.ok).toBe(false)
  })

  test('GET detail 404 for unknown task', async () => {
    const res = await handleCowork(
      new Request('http://localhost/api/cowork/tasks/t-does-not-exist'),
      '/api/cowork/tasks/t-does-not-exist',
    )
    expect(res).not.toBeNull()
    expect(res!.status).toBe(404)
  })

  test('GET /api/cowork/setup returns structured readiness', async () => {
    const res = await handleCowork(
      new Request('http://localhost/api/cowork/setup'),
      '/api/cowork/setup',
    )
    expect(res).not.toBeNull()
    expect(res!.status).toBe(200)
    const body = (await res!.json()) as {
      configured: boolean
      exe: string
      exeExists: boolean
      headlessSupported: boolean
      hint: string
      code?: string
      downloadUrl?: string
      releasesUrl?: string
    }
    expect(typeof body.exe).toBe('string')
    expect(typeof body.exeExists).toBe('boolean')
    expect(typeof body.headlessSupported).toBe('boolean')
    expect(typeof body.hint).toBe('string')
    expect(typeof body.downloadUrl).toBe('string')
    expect(typeof body.releasesUrl).toBe('string')
    if (!body.exeExists) {
      expect(body.configured).toBe(false)
      expect(body.code).toBe('COWORK_EXE_MISSING')
      expect(body.hint).toMatch(/Open Cowork executable not found/)
    } else if (!body.headlessSupported) {
      // Installed build is GUI-only (released 3.3.x): usable exe, no headless JSONL.
      expect(body.configured).toBe(false)
      expect(body.code).toBe('COWORK_HEADLESS_UNSUPPORTED')
      expect(body.hint).toMatch(/headless/i)
    } else {
      expect(body.configured).toBe(true)
    }
  })

  test('POST /api/cowork/tasks returns 503 when exe missing', async () => {
    const setup = await handleCowork(
      new Request('http://localhost/api/cowork/setup'),
      '/api/cowork/setup',
    )
    const setupBody = (await setup!.json()) as { exeExists: boolean }
    if (setupBody.exeExists) {
      // Machine has a real Open Cowork install — skip fail-path assertion.
      return
    }

    const res = await handleCowork(
      new Request('http://localhost/api/cowork/tasks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          goal: 'create document regarding the jnj',
          deliverableType: 'pdf',
        }),
      }),
      '/api/cowork/tasks',
    )
    expect(res).not.toBeNull()
    expect(res!.status).toBe(503)
    const body = (await res!.json()) as { error: string; code: string; exe: string }
    expect(body.code).toBe('COWORK_EXE_MISSING')
    expect(body.error).toMatch(/Open Cowork executable not found/)
    expect(body.error).not.toMatch(/ENOENT/)
  })
})

describe('handleCowork with seeded memory record', () => {
  afterEach(() => {
    resetCoworkTaskStateForTests()
  })

  test('GET detail returns in-memory task', async () => {
    // Seed via start path internals: run a tiny background task into a temp dir
    // is heavy; instead upsert through a successful runCoworkTask with persist:false
    const { runCoworkTask } = await import('../src/cowork/run-task')
    const workspace = await mkdtemp(join(tmpdir(), 'hermes-cowork-rest-'))
    const taskId = 't-20260711-300'
    await mkdir(join(workspace, 'outbox', taskId), { recursive: true })
    const mock = createMockCoworkSpawn({
      taskDelayMs: 5,
      writeStatusForTaskId: taskId,
    })

    await runCoworkTask({
      goal: 'Seeded',
      deliverableType: 'word',
      taskId,
      workspace,
      persist: false,
      timeoutMs: 5_000,
      createClient: (opts) =>
        new CoworkClient({
          ...opts,
          exe: 'mock',
          spawnFn: mock.spawnFn,
          readyTimeoutMs: 2_000,
        }),
    })

    expect(getCoworkTaskRecord(taskId)?.status).toBe('done')
    expect(getCoworkTaskRecord(taskId)?.inputFiles).toEqual([])

    // Detail handler reads outbox from config workspace, not our temp dir —
    // but live memory record should still satisfy GET when statusJson missing.
    const res = await handleCowork(
      new Request(`http://localhost/api/cowork/tasks/${taskId}`),
      `/api/cowork/tasks/${taskId}`,
    )
    expect(res).not.toBeNull()
    expect(res!.status).toBe(200)
    const body = (await res!.json()) as {
      taskId: string
      status: string
      goal: string | null
      inputFiles: string[] | null
    }
    expect(body.taskId).toBe(taskId)
    expect(body.status).toBe('done')
    expect(body.goal).toBe('Seeded')
    expect(body.inputFiles).toEqual([])
  }, 15_000)
})

describe('resolveCoworkWorkspace', () => {
  test('explicit override wins over env default', async () => {
    const { resolveCoworkWorkspace } = await import('../src/cowork/run-task')
    const override = await mkdtemp(join(tmpdir(), 'hermes-cowork-ws-'))
    const resolved = await resolveCoworkWorkspace(override)
    expect(resolved).toBe(resolve(override))
  })
})
