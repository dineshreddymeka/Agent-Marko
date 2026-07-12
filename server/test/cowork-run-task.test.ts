import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CoworkClient } from '../src/cowork/client'
import {
  abortCoworkTask,
  deliverablePromptAppendix,
  getActiveCoworkClient,
  getCoworkTaskRecord,
  resetCoworkTaskStateForTests,
  runCoworkTask,
  startCoworkTaskAsync,
} from '../src/cowork/run-task'
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
