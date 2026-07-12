/**
 * Open Cowork delegation integration smoke — mock JSONL child (no real install).
 * Mirrors §17 integration smoke behaviors from the Open Cowork technical guide.
 *
 * Live smoke (optional): set OPEN_COWORK_LIVE=1 and OPEN_COWORK_EXE to a real exe.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { CoworkClient } from '../src/cowork/client'
import { createMockCoworkSpawn } from './helpers/mock-cowork-child'

describe('Cowork integration (mock stdio child)', () => {
  let workspace: string

  beforeEach(() => {
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'cowork-int-'))
    fs.mkdirSync(path.join(workspace, 'logs'), { recursive: true })
    fs.mkdirSync(path.join(workspace, 'outbox'), { recursive: true })
    fs.mkdirSync(path.join(workspace, 'inbox'), { recursive: true })
  })

  afterEach(() => {
    try {
      fs.rmSync(workspace, { recursive: true, force: true })
    } catch {
      // ignore
    }
  })

  test('1. ready handshake within timeout', async () => {
    const mock = createMockCoworkSpawn({ readyDelayMs: 10 })
    const client = new CoworkClient({
      exe: 'mock-open-cowork',
      workspace,
      spawnFn: mock.spawnFn,
      readyTimeoutMs: 5_000,
    })

    const startedAt = Date.now()
    await client.start({ cwd: workspace, autoApprove: true })
    expect(Date.now() - startedAt).toBeLessThan(5_000)
    expect(mock.getLastChild()).not.toBeNull()
    await client.stop(50)
  })

  test('2. full task run produces session.end + status.json outbox', async () => {
    const taskId = 't-smoke-001'
    const mock = createMockCoworkSpawn({
      writeStatusForTaskId: taskId,
      textDeltas: ['wrote hello.txt', ' and status.json'],
      taskDelayMs: 15,
    })
    const client = new CoworkClient({
      exe: 'mock-open-cowork',
      workspace,
      spawnFn: mock.spawnFn,
      readyTimeoutMs: 5_000,
    })
    await client.start({ cwd: workspace, autoApprove: true })

    const result = await client.runTask(
      taskId,
      `Write a file outbox/${taskId}/hello.txt then status.json`,
      5_000,
    )

    expect(result.sessionId).toMatch(/^mock-sess-/)
    expect(result.events.some((e) => e.type === 'session.started')).toBe(true)
    expect(result.events.some((e) => e.type === 'session.end')).toBe(true)
    expect(result.resultText).toContain('hello.txt')
    expect(result.ok).toBe(true)
    expect(result.status).toMatchObject({ taskId, ok: true })

    const statusPath = path.join(workspace, 'outbox', taskId, 'status.json')
    expect(fs.existsSync(statusPath)).toBe(true)
    const helloPath = path.join(workspace, 'outbox', taskId, 'hello.txt')
    expect(fs.readFileSync(helloPath, 'utf8')).toContain('hello from mock cowork')

    await client.stop(50)
  })

  test('3. session.abort ends session', async () => {
    const mock = createMockCoworkSpawn({ hangUntilAbort: true })
    const client = new CoworkClient({
      exe: 'mock-open-cowork',
      workspace,
      spawnFn: mock.spawnFn,
      readyTimeoutMs: 5_000,
    })
    await client.start({ cwd: workspace })

    let capturedSessionId: string | null = null
    const unsub = client.onEvent((evt) => {
      if (evt.type === 'session.started' && typeof evt.sessionId === 'string') {
        capturedSessionId = evt.sessionId
      }
    })

    const task = client.runTask('t-abort', 'long running task please', 10_000)

    // Wait until session has started
    const deadline = Date.now() + 2_000
    while (!capturedSessionId && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 10))
    }
    expect(capturedSessionId).toBeTruthy()

    client.send({ type: 'session.abort', sessionId: capturedSessionId! })

    const result = await Promise.race([
      task,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('abort did not end session in time')), 2_000),
      ),
    ])

    unsub()
    expect(result.sessionId).toBe(capturedSessionId)
    expect(result.events.some((e) => e.type === 'session.end')).toBe(true)
    await client.stop(50)
  })

  test('4. child crash mid-session fails task cleanly', async () => {
    const mock = createMockCoworkSpawn({
      crashAfterStart: true,
      crashExitCode: 1,
      taskDelayMs: 10,
    })
    const client = new CoworkClient({
      exe: 'mock-open-cowork',
      workspace,
      spawnFn: mock.spawnFn,
      readyTimeoutMs: 5_000,
    })
    await client.start({ cwd: workspace })

    await expect(client.runTask('t-crash', 'doomed', 5_000)).rejects.toThrow(
      /stopped during task/,
    )

    // Client should be marked not-started / crashed; a fresh start via new client works.
    const mock2 = createMockCoworkSpawn()
    const client2 = new CoworkClient({
      exe: 'mock-open-cowork',
      workspace,
      spawnFn: mock2.spawnFn,
      readyTimeoutMs: 5_000,
    })
    await client2.start({ cwd: workspace })
    const ok = await client2.runTask('t-after-crash', 'recover', 5_000)
    expect(ok.events.some((e) => e.type === 'session.end')).toBe(true)
    await client2.stop(50)
  })

  test('5. malformed stdout line is skipped (does not crash client)', async () => {
    const mock = createMockCoworkSpawn({
      emitMalformedLine: true,
      textDeltas: ['still ok'],
      taskDelayMs: 15,
    })
    const client = new CoworkClient({
      exe: 'mock-open-cowork',
      workspace,
      spawnFn: mock.spawnFn,
      readyTimeoutMs: 5_000,
    })
    await client.start({ cwd: workspace })

    const result = await client.runTask('t-malformed', 'handle junk', 5_000)
    expect(result.resultText).toBe('still ok')
    expect(result.events.some((e) => e.type === 'session.end')).toBe(true)
    expect(client.stderrTail()).toContain('unparseable stdout line')
    await client.stop(50)
  })
})

const liveEnabled =
  process.env.OPEN_COWORK_LIVE === '1' &&
  Boolean(process.env.OPEN_COWORK_EXE) &&
  fs.existsSync(process.env.OPEN_COWORK_EXE!)

describe.skipIf(!liveEnabled)('Cowork live smoke (OPEN_COWORK_LIVE)', () => {
  test('stdio.ready within 60s against real Open Cowork', async () => {
    const workspace =
      process.env.OPEN_COWORK_WORKSPACE ||
      path.join(os.tmpdir(), 'cowork-live-smoke')
    fs.mkdirSync(workspace, { recursive: true })

    const client = new CoworkClient({
      exe: process.env.OPEN_COWORK_EXE,
      workspace,
      readyTimeoutMs: 60_000,
    })

    await client.start({ cwd: workspace, autoApprove: true })
    await client.stop(5_000)
  }, 90_000)
})
