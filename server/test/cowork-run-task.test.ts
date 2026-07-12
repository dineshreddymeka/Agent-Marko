import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CoworkClient } from '../src/cowork/client'
import {
  abortCoworkTask,
  buildStatusCorrectionMessage,
  deliverablePromptAppendix,
  getActiveCoworkClient,
  getCoworkTaskRecord,
  isStructuralStatusFailure,
  resetCoworkTaskStateForTests,
  runCoworkTask,
  sendCoworkTaskMessage,
  startCoworkTaskAsync,
} from '../src/cowork/run-task'
import type { CoworkEvent } from '../src/cowork/types'
import { createMockCoworkSpawn } from './helpers/mock-cowork-child'

async function tempWorkspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'hermes-cowork-run-'))
  await mkdir(join(root, 'outbox'), { recursive: true })
  return root
}

describe('deliverablePromptAppendix', () => {
  test('maps each deliverable type to an outbox hint', () => {
    const id = 't-20260711-100'
    expect(deliverablePromptAppendix('presentation', id)).toContain('deck.pptx')
    expect(deliverablePromptAppendix('word', id)).toContain('report.docx')
    expect(deliverablePromptAppendix('spreadsheet', id)).toContain('data.xlsx')
    expect(deliverablePromptAppendix('pdf', id)).toContain('report.pdf')
    expect(deliverablePromptAppendix('other', id)).toContain(`outbox/${id}`)
  })
})

describe('runCoworkTask', () => {
  afterEach(() => {
    resetCoworkTaskStateForTests()
  })

  test(
    'packages, runs mock client, validates status, skips persist',
    async () => {
      const workspace = await tempWorkspace()
      const taskId = 't-20260711-200'
      const mock = createMockCoworkSpawn({
        taskDelayMs: 5,
        writeStatusForTaskId: taskId,
        textDeltas: ['done'],
      })

      await mkdir(join(workspace, 'outbox', taskId), { recursive: true })

      const result = await runCoworkTask({
        goal: 'Make a short deck',
        deliverableType: 'presentation',
        taskId,
        workspace,
        persist: false,
        timeoutMs: 5_000,
        createClient: (opts) =>
          new CoworkClient({
            ...opts,
            exe: 'mock-open-cowork',
            spawnFn: mock.spawnFn,
            readyTimeoutMs: 2_000,
          }),
      })

      expect(result.taskId).toBe(taskId)
      expect(result.ok).toBe(true)
      expect(result.status).toBe('done')
      expect(result.prompt).toContain('deck.pptx')
      expect(result.briefPath).toBe(`inbox/${taskId}/brief.md`)

      const brief = await readFile(join(workspace, 'inbox', taskId, 'brief.md'), 'utf8')
      expect(brief).toContain('Make a short deck')
      expect(brief).toContain('deck.pptx')

      const record = getCoworkTaskRecord(taskId)
      expect(record?.status).toBe('done')
      expect(getActiveCoworkClient(taskId)).toBeUndefined()
    },
    15_000,
  )

  test(
    'abort marks running task aborted',
    async () => {
      const workspace = await tempWorkspace()
      const taskId = 't-20260711-201'
      const mock = createMockCoworkSpawn({
        hangUntilAbort: true,
        taskDelayMs: 50,
      })

      const runPromise = runCoworkTask({
        goal: 'Hang forever',
        taskId,
        workspace,
        persist: false,
        timeoutMs: 10_000,
        createClient: (opts) =>
          new CoworkClient({
            ...opts,
            exe: 'mock-open-cowork',
            spawnFn: mock.spawnFn,
            readyTimeoutMs: 2_000,
          }),
      })

      const deadline = Date.now() + 2_000
      while (!getActiveCoworkClient(taskId) && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 10))
      }
      expect(getActiveCoworkClient(taskId)).toBeTruthy()

      // Wait until session id is known so abort uses session.abort (not stop).
      await new Promise((r) => setTimeout(r, 50))

      const aborted = await abortCoworkTask(taskId)
      expect(aborted.ok).toBe(true)
      expect(aborted.status).toBe('aborted')

      // session.abort ends the session cleanly; runner finishes and preserves aborted.
      const result = await runPromise
      expect(result.status).toBe('aborted')
      expect(getCoworkTaskRecord(taskId)?.status).toBe('aborted')
    },
    15_000,
  )

  test(
    'corrective session.message recovers missing status.json',
    async () => {
      const workspace = await tempWorkspace()
      const taskId = 't-20260711-210'
      const mock = createMockCoworkSpawn({
        taskDelayMs: 5,
        onMessageWriteStatusForTaskId: taskId,
      })

      const result = await runCoworkTask({
        goal: 'Recover via corrective message',
        taskId,
        workspace,
        persist: false,
        timeoutMs: 5_000,
        statusCorrectionTimeoutMs: 2_000,
        createClient: (opts) =>
          new CoworkClient({
            ...opts,
            exe: 'mock-open-cowork',
            spawnFn: mock.spawnFn,
            readyTimeoutMs: 2_000,
          }),
      })

      expect(result.ok).toBe(true)
      expect(result.status).toBe('done')
      expect(result.validationError).toBeNull()
      expect(getCoworkTaskRecord(taskId)?.status).toBe('done')
    },
    15_000,
  )

  test(
    'corrective retry is bounded and fails when status.json never appears',
    async () => {
      const workspace = await tempWorkspace()
      const taskId = 't-20260711-211'
      const mock = createMockCoworkSpawn({ taskDelayMs: 5 })

      const result = await runCoworkTask({
        goal: 'Never writes status',
        taskId,
        workspace,
        persist: false,
        timeoutMs: 5_000,
        statusCorrectionTimeoutMs: 150,
        createClient: (opts) =>
          new CoworkClient({
            ...opts,
            exe: 'mock-open-cowork',
            spawnFn: mock.spawnFn,
            readyTimeoutMs: 2_000,
          }),
      })

      expect(result.ok).toBe(false)
      expect(result.status).toBe('failed')
      expect(result.validationError).toMatch(/status\.json missing/)
    },
    15_000,
  )

  test(
    'onEvent hook streams events and AbortSignal aborts the task',
    async () => {
      const workspace = await tempWorkspace()
      const taskId = 't-20260711-212'
      const mock = createMockCoworkSpawn({ hangUntilAbort: true })
      const seen: CoworkEvent[] = []
      const controller = new AbortController()

      const runPromise = runCoworkTask({
        goal: 'Hang until signal abort',
        taskId,
        workspace,
        persist: false,
        timeoutMs: 10_000,
        statusCorrectionTimeoutMs: 100,
        onEvent: (evt) => seen.push(evt),
        signal: controller.signal,
        createClient: (opts) =>
          new CoworkClient({
            ...opts,
            exe: 'mock-open-cowork',
            spawnFn: mock.spawnFn,
            readyTimeoutMs: 2_000,
          }),
      })

      const deadline = Date.now() + 2_000
      while (
        !seen.some((e) => e.type === 'session.started') &&
        Date.now() < deadline
      ) {
        await new Promise((r) => setTimeout(r, 10))
      }
      expect(seen.some((e) => e.type === 'session.started')).toBe(true)

      controller.abort()
      const result = await runPromise
      expect(result.status).toBe('aborted')
      expect(getCoworkTaskRecord(taskId)?.status).toBe('aborted')
    },
    15_000,
  )

  test(
    'sendCoworkTaskMessage requires a live task with a session id',
    async () => {
      const missing = sendCoworkTaskMessage('t-nope', 'hello')
      expect(missing).toEqual({
        ok: false,
        code: 'not_live',
        error: 'No active Cowork process for this task',
      })

      const workspace = await tempWorkspace()
      const taskId = 't-20260711-213'
      const mock = createMockCoworkSpawn({ hangUntilAbort: true })

      const runPromise = runCoworkTask({
        goal: 'Hang for message',
        taskId,
        workspace,
        persist: false,
        timeoutMs: 10_000,
        statusCorrectionTimeoutMs: 100,
        createClient: (opts) =>
          new CoworkClient({
            ...opts,
            exe: 'mock-open-cowork',
            spawnFn: mock.spawnFn,
            readyTimeoutMs: 2_000,
          }),
      })

      const deadline = Date.now() + 2_000
      while (!getActiveCoworkClient(taskId) && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 10))
      }
      await new Promise((r) => setTimeout(r, 50))

      const sent = sendCoworkTaskMessage(taskId, 'extra instruction')
      expect(sent).toEqual({ ok: true })

      await abortCoworkTask(taskId)
      await runPromise
    },
    15_000,
  )

  test('isStructuralStatusFailure / buildStatusCorrectionMessage', () => {
    expect(
      isStructuralStatusFailure({ ok: false, error: 'status.json missing at x' }),
    ).toBe(true)
    expect(
      isStructuralStatusFailure({
        ok: false,
        error: 'status.json missing required boolean field: ok',
        status: null,
      }),
    ).toBe(true)
    expect(
      isStructuralStatusFailure({
        ok: false,
        error: 'status.json reports ok:false',
        status: { taskId: 't', ok: false, files: [] },
        resolvedFiles: [],
      }),
    ).toBe(false)

    const msg = buildStatusCorrectionMessage('t-123', 'status.json missing')
    expect(msg).toContain('outbox/t-123/status.json')
    expect(msg).toContain('jarvis-bridge')
  })

  test(
    'startCoworkTaskAsync returns immediately with queued',
    async () => {
      const workspace = await tempWorkspace()
      const taskId = 't-20260711-202'
      const mock = createMockCoworkSpawn({
        taskDelayMs: 30,
        writeStatusForTaskId: taskId,
      })
      await mkdir(join(workspace, 'outbox', taskId), { recursive: true })

      const started = await startCoworkTaskAsync({
        goal: 'Async deck',
        deliverableType: 'presentation',
        taskId,
        workspace,
        persist: false,
        timeoutMs: 5_000,
        createClient: (opts) =>
          new CoworkClient({
            ...opts,
            exe: 'mock-open-cowork',
            spawnFn: mock.spawnFn,
            readyTimeoutMs: 2_000,
          }),
      })

      expect(started.taskId).toBe(taskId)
      expect(started.status).toBe('queued')

      const finalDeadline = Date.now() + 8_000
      while (
        !['done', 'failed'].includes(getCoworkTaskRecord(taskId)?.status ?? '') &&
        Date.now() < finalDeadline
      ) {
        await new Promise((r) => setTimeout(r, 30))
      }
      expect(getCoworkTaskRecord(taskId)?.status).toBe('done')
    },
    15_000,
  )
})
