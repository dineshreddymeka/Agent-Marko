import { afterEach, describe, expect, test } from 'bun:test'
import { HermesCustomEvents } from '@hermes/shared'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CoworkClient } from '../src/cowork/client'
import {
  getCoworkTaskRecord,
  resetCoworkTaskStateForTests,
  runCoworkTask,
} from '../src/cowork/run-task'
import { getTool } from '../src/agent/tools/registry'
import '../src/agent/tools/delegate_to_cowork'

describe('delegate_to_cowork tool registration', () => {
  afterEach(() => {
    resetCoworkTaskStateForTests()
  })

  test('registers with deliverableType and rejects empty goal', async () => {
    const tool = getTool('delegate_to_cowork')
    expect(tool).toBeTruthy()
    expect(tool!.parameters.properties).toHaveProperty('deliverableType')
    expect(tool!.parameters.properties).toHaveProperty('goal')

    await expect(
      tool!.execute(
        { goal: '   ', deliverableType: 'pptx' },
        {
          sessionId: 's',
          runId: 'r',
          signal: new AbortController().signal,
        },
      ),
    ).rejects.toThrow(/goal is required/)

    await expect(
      tool!.execute(
        { goal: 'Make a deck', deliverableType: 'movie' },
        {
          sessionId: 's',
          runId: 'r',
          signal: new AbortController().signal,
        },
      ),
    ).rejects.toThrow(/deliverableType/)
  })

  test(
    'chat hooks: onEvent + AbortSignal abort a live Cowork run',
    async () => {
      const { createMockCoworkSpawn } = await import('./helpers/mock-cowork-child')
      const workspace = await mkdtemp(join(tmpdir(), 'hermes-cowork-tool-'))
      const mock = createMockCoworkSpawn({ hangUntilAbort: true })
      const progressPhases: string[] = []
      const controller = new AbortController()
      const taskId = 't-20260712-400'
      await mkdir(join(workspace, 'outbox', taskId), { recursive: true })

      // Mirrors what delegate_to_cowork wires into runCoworkTask for chat cancel/progress.
      const runPromise = runCoworkTask({
        goal: 'Hang for chat cancel',
        taskId,
        workspace,
        persist: false,
        timeoutMs: 10_000,
        statusCorrectionTimeoutMs: 100,
        signal: controller.signal,
        onEvent: (evt) => {
          if (evt.type === 'session.started') progressPhases.push('started')
          if (evt.type === 'session.end') progressPhases.push('ended')
        },
        createClient: (opts) =>
          new CoworkClient({
            ...opts,
            exe: 'mock',
            spawnFn: mock.spawnFn,
            readyTimeoutMs: 2_000,
          }),
      })

      const deadline = Date.now() + 2_000
      while (!progressPhases.includes('started') && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 10))
      }
      expect(progressPhases).toContain('started')
      expect(HermesCustomEvents.COWORK_PROGRESS).toBe('hermes.cowork.progress')

      controller.abort()
      const result = await runPromise
      expect(result.status).toBe('aborted')
      expect(getCoworkTaskRecord(taskId)?.status).toBe('aborted')
    },
    15_000,
  )
})
