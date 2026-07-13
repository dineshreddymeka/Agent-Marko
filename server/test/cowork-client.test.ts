import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import type { ChildProcess, SpawnOptions } from 'node:child_process'
import {
  CoworkClient,
  coworkExeExists,
  formatCoworkExeMissingMessage,
  getCoworkSetupInfo,
  resolveCoworkExe,
  resolveCoworkWorkspace,
} from '../src/cowork/client'
import type { CoworkSpawnFn } from '../src/cowork/types'

async function expectRejected(promise: Promise<unknown>, pattern: RegExp): Promise<void> {
  try {
    await promise
    throw new Error(`expected promise to reject matching ${pattern}`)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (message.startsWith('expected promise to reject')) throw err
    expect(message).toMatch(pattern)
  }
}

type MockChild = ChildProcess & {
  stdin: PassThrough
  stdout: PassThrough
  stderr: PassThrough
  stdinWrites: string[]
  /** Test helper: push a JSONL event line to stdout. */
  emitLine: (obj: object) => void
  /** Test helper: end process with exit code. */
  exitWith: (code: number | null, signal?: NodeJS.Signals | null) => void
}

function createMockChild(): MockChild {
  const stdin = new PassThrough()
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  const ee = new EventEmitter() as MockChild
  const writes: string[] = []

  // Drain stdin so writers never backpressure/block.
  stdin.on('data', (c: Buffer | string) => {
    writes.push(typeof c === 'string' ? c : c.toString('utf8'))
  })

  let exitCode: number | null = null
  let signalCode: NodeJS.Signals | null = null
  let killed = false

  Object.defineProperties(ee, {
    stdin: { value: stdin, enumerable: true },
    stdout: { value: stdout, enumerable: true },
    stderr: { value: stderr, enumerable: true },
    pid: { value: 4242, enumerable: true },
    exitCode: {
      get: () => exitCode,
      enumerable: true,
    },
    signalCode: {
      get: () => signalCode,
      enumerable: true,
    },
    killed: {
      get: () => killed,
      enumerable: true,
    },
  })

  ee.kill = ((_signal?: NodeJS.Signals | number) => {
    killed = true
    if (exitCode === null && signalCode === null) {
      signalCode = 'SIGTERM'
      queueMicrotask(() => ee.emit('exit', exitCode, signalCode))
    }
    return true
  }) as ChildProcess['kill']

  ee.emitLine = (obj: object) => {
    stdout.write(JSON.stringify(obj) + '\n')
  }

  ee.exitWith = (code, signal = null) => {
    exitCode = code
    signalCode = signal
    try {
      stdout.end()
    } catch {
      /* ignore */
    }
    try {
      stderr.end()
    } catch {
      /* ignore */
    }
    queueMicrotask(() => ee.emit('exit', code, signal))
  }

  ;(ee as MockChild).stdinWrites = writes

  return ee
}

describe('resolveCoworkExe / resolveCoworkWorkspace', () => {
  const prev = {
    OPEN_COWORK_EXE: process.env.OPEN_COWORK_EXE,
    OPEN_COWORK_PATH: process.env.OPEN_COWORK_PATH,
    COWORK_EXE: process.env.COWORK_EXE,
    OPEN_COWORK_WORKSPACE: process.env.OPEN_COWORK_WORKSPACE,
    LOCALAPPDATA: process.env.LOCALAPPDATA,
  }

  afterEach(() => {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  })

  test('OPEN_COWORK_EXE takes precedence over COWORK_EXE', () => {
    process.env.OPEN_COWORK_EXE = 'C:\\open\\A.exe'
    process.env.COWORK_EXE = 'C:\\open\\B.exe'
    expect(resolveCoworkExe()).toBe('C:\\open\\A.exe')
  })

  test('OPEN_COWORK_PATH used when OPEN_COWORK_EXE unset', () => {
    delete process.env.OPEN_COWORK_EXE
    process.env.OPEN_COWORK_PATH = 'C:\\open\\P.exe'
    process.env.COWORK_EXE = 'C:\\open\\B.exe'
    expect(resolveCoworkExe()).toBe('C:\\open\\P.exe')
  })

  test('COWORK_EXE used when OPEN_COWORK_EXE unset', () => {
    delete process.env.OPEN_COWORK_EXE
    delete process.env.OPEN_COWORK_PATH
    process.env.COWORK_EXE = 'C:\\open\\B.exe'
    expect(resolveCoworkExe()).toBe('C:\\open\\B.exe')
  })

  test('override arg wins over env', () => {
    process.env.OPEN_COWORK_EXE = 'C:\\open\\A.exe'
    expect(resolveCoworkExe('C:\\custom\\X.exe')).toBe('C:\\custom\\X.exe')
  })

  test('Windows default prefers Programs\\Open Cowork when present', () => {
    delete process.env.OPEN_COWORK_EXE
    delete process.env.OPEN_COWORK_PATH
    delete process.env.COWORK_EXE
    process.env.LOCALAPPDATA = 'C:\\Users\\test\\AppData\\Local'
    expect(resolveCoworkExe()).toBe(
      path.join('C:\\Users\\test\\AppData\\Local', 'Programs', 'Open Cowork', 'Open Cowork.exe'),
    )
  })

  test('workspace from OPEN_COWORK_WORKSPACE or data-dir default', () => {
    delete process.env.OPEN_COWORK_WORKSPACE
    const { config } = require('../src/config') as typeof import('../src/config')
    expect(resolveCoworkWorkspace()).toBe(config.OPEN_COWORK_WORKSPACE)
    process.env.OPEN_COWORK_WORKSPACE = 'D:/ws'
    expect(resolveCoworkWorkspace()).toBe('D:/ws')
    expect(resolveCoworkWorkspace('E:/override')).toBe('E:/override')
  })

  test('getCoworkSetupInfo reports missing exe without throwing', () => {
    delete process.env.OPEN_COWORK_EXE
    delete process.env.OPEN_COWORK_PATH
    delete process.env.COWORK_EXE
    process.env.LOCALAPPDATA = 'C:\\Users\\test\\AppData\\Local'
    const info = getCoworkSetupInfo()
    expect(info.exeExists).toBe(false)
    expect(info.configured).toBe(false)
    expect(info.hint).toMatch(/Open Cowork executable not found/)
    expect(coworkExeExists(info.exe)).toBe(false)
  })

  test('formatCoworkExeMissingMessage is actionable', () => {
    expect(formatCoworkExeMissingMessage('C:\\missing\\Open Cowork.exe')).toMatch(
      /OPEN_COWORK_EXE/,
    )
  })
})

describe('CoworkClient', () => {
  let workspace: string
  let lastChild: MockChild | null
  let lastSpawn: { command: string; args: readonly string[]; options?: SpawnOptions } | null

  beforeEach(() => {
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'cowork-ws-'))
    fs.mkdirSync(path.join(workspace, 'logs'), { recursive: true })
    fs.mkdirSync(path.join(workspace, 'outbox'), { recursive: true })
    lastChild = null
    lastSpawn = null
  })

  afterEach(async () => {
    try {
      fs.rmSync(workspace, { recursive: true, force: true })
    } catch {
      // ignore
    }
  })

  function spawnFn(): CoworkSpawnFn {
    return (command, args, options) => {
      lastSpawn = { command, args, options }
      lastChild = createMockChild()
      return lastChild
    }
  }

  async function startReady(client: CoworkClient, opts?: { autoApprove?: boolean }) {
    const p = client.start({ cwd: workspace, ...opts })
    // stdout reader must be attached; emit ready on next tick
    await Promise.resolve()
    expect(lastChild).not.toBeNull()
    lastChild!.emitLine({ type: 'stdio.ready' })
    await p
  }

  test('start rejects missing exe with clear message (real spawn)', async () => {
    const missing = path.join(workspace, 'definitely-missing-Open-Cowork.exe')
    const client = new CoworkClient({
      exe: missing,
      workspace,
      readyTimeoutMs: 1_000,
    })
    await expectRejected(client.start(), /Open Cowork executable not found/)
    await expectRejected(client.start(), /OPEN_COWORK_EXE/)
  })

  test('start spawns with headless stdio flags and waits for stdio.ready', async () => {
    const client = new CoworkClient({
      exe: 'C:\\fake\\Open Cowork.exe',
      workspace,
      spawnFn: spawnFn(),
      readyTimeoutMs: 5_000,
    })
    await startReady(client, { autoApprove: true })
    expect(lastSpawn?.command).toBe('C:\\fake\\Open Cowork.exe')
    expect(lastSpawn?.args).toEqual([
      '--headless',
      '--mode',
      'stdio',
      '--cwd',
      workspace,
      '--auto-approve',
    ])
    expect(lastSpawn?.options?.stdio).toEqual(['pipe', 'pipe', 'pipe'])
    await client.stop(50)
  })

  test('attaches stdout reader before stdin write (runTask)', async () => {
    const client = new CoworkClient({
      exe: 'fake.exe',
      workspace,
      spawnFn: spawnFn(),
      readyTimeoutMs: 5_000,
    })
    await startReady(client)

    const task = client.runTask('t-1', 'do the thing', 5_000)
    // Allow send to flush
    await new Promise((r) => setTimeout(r, 10))
    expect(lastChild!.stdinWrites.length).toBeGreaterThan(0)
    const sent = lastChild!.stdinWrites.join('')
    expect(JSON.parse(sent.trim())).toEqual({ type: 'session.start', prompt: 'do the thing' })

    lastChild!.emitLine({ type: 'session.started', sessionId: 'sess-1' })
    lastChild!.emitLine({ type: 'agent.text_delta', sessionId: 'sess-1', text: 'hello ' })
    lastChild!.emitLine({ type: 'agent.text_delta', sessionId: 'sess-1', text: 'world' })
    lastChild!.emitLine({ type: 'session.end', sessionId: 'sess-1', result: 'done' })

    const result = await task
    expect(result.sessionId).toBe('sess-1')
    expect(result.resultText).toBe('hello world')
    expect(result.events.map((e) => e.type)).toEqual([
      'session.started',
      'agent.text_delta',
      'agent.text_delta',
      'session.end',
    ])
    await client.stop(50)
  })

  test('rejects on session-scoped error', async () => {
    const client = new CoworkClient({
      exe: 'fake.exe',
      workspace,
      spawnFn: spawnFn(),
      readyTimeoutMs: 5_000,
    })
    await startReady(client)

    const task = client.runTask('t-err', 'fail please', 5_000)
    await new Promise((r) => setTimeout(r, 10))
    lastChild!.emitLine({ type: 'session.started', sessionId: 's-err' })
    lastChild!.emitLine({ type: 'error', sessionId: 's-err', message: 'boom' })

    await expectRejected(task, /cowork error: boom/)
    await client.stop(50)
  })

  test('protocol error without sessionId is non-fatal', async () => {
    const client = new CoworkClient({
      exe: 'fake.exe',
      workspace,
      spawnFn: spawnFn(),
      readyTimeoutMs: 5_000,
    })
    await startReady(client)

    const task = client.runTask('t-proto', 'ok', 5_000)
    await new Promise((r) => setTimeout(r, 10))
    lastChild!.emitLine({ type: 'session.started', sessionId: 's2' })
    lastChild!.emitLine({ type: 'error', message: 'Invalid JSON: x' })
    lastChild!.emitLine({ type: 'session.end', sessionId: 's2' })

    const result = await task
    expect(result.sessionId).toBe('s2')
    expect(result.events.some((e) => e.type === 'error')).toBe(true)
    await client.stop(50)
  })

  test('timeout sends session.abort and rejects', async () => {
    const client = new CoworkClient({
      exe: 'fake.exe',
      workspace,
      spawnFn: spawnFn(),
      readyTimeoutMs: 5_000,
    })
    await startReady(client)

    const task = client.runTask('t-to', 'slow', 80)
    await new Promise((r) => setTimeout(r, 10))
    lastChild!.emitLine({ type: 'session.started', sessionId: 's-to' })

    await expectRejected(task, /timed out/)
    const all = lastChild!.stdinWrites.join('')
    expect(all).toContain('"session.abort"')
    expect(all).toContain('"s-to"')
    await client.stop(50)
  })

  test('crash during task rejects', async () => {
    const client = new CoworkClient({
      exe: 'fake.exe',
      workspace,
      spawnFn: spawnFn(),
      readyTimeoutMs: 5_000,
    })
    await startReady(client)

    const task = client.runTask('t-crash', 'die', 5_000)
    await new Promise((r) => setTimeout(r, 10))
    lastChild!.emitLine({ type: 'session.started', sessionId: 's-crash' })
    lastChild!.stderr.write('fatal oops\n')
    lastChild!.exitWith(1)

    await expectRejected(task, /stopped during task/)
  })

  test('exited before ready rejects start', async () => {
    const client = new CoworkClient({
      exe: 'fake.exe',
      workspace,
      spawnFn: spawnFn(),
      readyTimeoutMs: 5_000,
    })
    const p = client.start({ cwd: workspace })
    await Promise.resolve()
    lastChild!.stderr.write('bad cwd\n')
    lastChild!.exitWith(1)
    await expectRejected(p, /exited before ready/)
  })

  test('keeps stderrTail and never treats stderr as protocol', async () => {
    const client = new CoworkClient({
      exe: 'fake.exe',
      workspace,
      spawnFn: spawnFn(),
      readyTimeoutMs: 5_000,
    })
    await startReady(client)
    lastChild!.stderr.write('warning banner\nline2\n')
    await new Promise((r) => setTimeout(r, 10))
    expect(client.stderrTail()).toContain('warning banner')
    expect(client.stderrTail()).toContain('line2')

    // Malformed stdout is logged/skipped, not thrown
    lastChild!.stdout.write('not-json\n')
    lastChild!.emitLine({ type: 'stdio.ready' }) // already ready; just another event
    await new Promise((r) => setTimeout(r, 10))
    expect(client.stderrTail()).toContain('unparseable stdout line')
    await client.stop(50)
  })

  test('writes events to workspace logs when writable', async () => {
    const client = new CoworkClient({
      exe: 'fake.exe',
      workspace,
      spawnFn: spawnFn(),
      readyTimeoutMs: 5_000,
    })
    await startReady(client)

    const task = client.runTask('t-log', 'log me', 5_000)
    await new Promise((r) => setTimeout(r, 10))
    lastChild!.emitLine({ type: 'session.started', sessionId: 's-log' })
    lastChild!.emitLine({ type: 'session.end', sessionId: 's-log' })
    await task

    const logPath = path.join(workspace, 'logs', 't-log.jsonl')
    expect(fs.existsSync(logPath)).toBe(true)
    const body = fs.readFileSync(logPath, 'utf8')
    expect(body).toContain('session.started')
    expect(body).toContain('session.end')
    await client.stop(50)
  })

  test('serializes concurrent runTask calls', async () => {
    const client = new CoworkClient({
      exe: 'fake.exe',
      workspace,
      spawnFn: spawnFn(),
      readyTimeoutMs: 5_000,
    })
    await startReady(client)

    const order: string[] = []
    const t1 = client.runTask('t-a', 'first', 5_000).then((r) => {
      order.push('a-done')
      return r
    })
    const t2 = client.runTask('t-b', 'second', 5_000).then((r) => {
      order.push('b-done')
      return r
    })

    await new Promise((r) => setTimeout(r, 15))
    // Only first session.start should have been sent
    lastChild!.emitLine({ type: 'session.started', sessionId: 'sa' })
    lastChild!.emitLine({ type: 'session.end', sessionId: 'sa' })
    await t1

    await new Promise((r) => setTimeout(r, 15))
    lastChild!.emitLine({ type: 'session.started', sessionId: 'sb' })
    lastChild!.emitLine({ type: 'session.end', sessionId: 'sb' })
    await t2

    expect(order).toEqual(['a-done', 'b-done'])
    await client.stop(50)
  })

  test('reads outbox status.json for ok flag', async () => {
    const client = new CoworkClient({
      exe: 'fake.exe',
      workspace,
      spawnFn: spawnFn(),
      readyTimeoutMs: 5_000,
    })
    await startReady(client)

    const outDir = path.join(workspace, 'outbox', 't-status')
    fs.mkdirSync(outDir, { recursive: true })
    fs.writeFileSync(
      path.join(outDir, 'status.json'),
      JSON.stringify({ taskId: 't-status', ok: true, files: ['a.txt'] }),
    )

    const task = client.runTask('t-status', 'done', 5_000)
    await new Promise((r) => setTimeout(r, 10))
    lastChild!.emitLine({ type: 'session.started', sessionId: 'ss' })
    lastChild!.emitLine({ type: 'session.end', sessionId: 'ss' })
    const result = await task
    expect(result.ok).toBe(true)
    expect(result.status).toEqual({ taskId: 't-status', ok: true, files: ['a.txt'] })
    await client.stop(50)
  })

  test('sendMessage emits session.message JSONL', async () => {
    const client = new CoworkClient({
      exe: 'fake.exe',
      workspace,
      spawnFn: spawnFn(),
      readyTimeoutMs: 5_000,
    })
    await startReady(client)

    client.sendMessage('sess-msg', 'please write status.json')
    await new Promise((r) => setTimeout(r, 10))
    const lines = lastChild!.stdinWrites.join('').trim().split('\n')
    expect(JSON.parse(lines.at(-1)!)).toEqual({
      type: 'session.message',
      sessionId: 'sess-msg',
      text: 'please write status.json',
    })
    await client.stop(50)
  })

  test('sendMessage throws when not started', () => {
    const client = new CoworkClient({
      exe: 'fake.exe',
      workspace,
      spawnFn: spawnFn(),
    })
    expect(() => client.sendMessage('s', 'x')).toThrow(/not started/)
  })

  test('handles partial JSONL chunks on stdout', async () => {
    const client = new CoworkClient({
      exe: 'fake.exe',
      workspace,
      spawnFn: spawnFn(),
      readyTimeoutMs: 5_000,
    })
    const p = client.start({ cwd: workspace })
    await Promise.resolve()
    lastChild!.stdout.write('{"type":"std')
    lastChild!.stdout.write('io.ready"}\n')
    await p

    const task = client.runTask('t-partial', 'x', 5_000)
    await new Promise((r) => setTimeout(r, 10))
    lastChild!.stdout.write('{"type":"session.started","ses')
    lastChild!.stdout.write('sionId":"sp"}\n')
    lastChild!.stdout.write('{"type":"session.end","sessionId":"sp"}\n')
    const result = await task
    expect(result.sessionId).toBe('sp')
    await client.stop(50)
  })
})
