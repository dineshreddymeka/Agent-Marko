/**
 * Autonomous mock Open Cowork child: speaks JSONL stdio protocol without a real install.
 * Emits `stdio.ready`, answers `session.start` / `session.abort`, and can crash on demand.
 */
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import * as fs from 'node:fs'
import * as path from 'node:path'
import type { ChildProcess, SpawnOptions } from 'node:child_process'
import type { CoworkSpawnFn } from '../../src/cowork/types'

export type MockCoworkChild = ChildProcess & {
  stdin: PassThrough
  stdout: PassThrough
  stderr: PassThrough
  /** Last spawn args (includes --cwd). */
  spawnArgs: readonly string[]
  emitLine: (obj: object) => void
  exitWith: (code: number | null, signal?: NodeJS.Signals | null) => void
}

export type MockCoworkChildBehavior = {
  /** Delay before `stdio.ready` (default 0). */
  readyDelayMs?: number
  /** If true, never emit `stdio.ready`. */
  skipReady?: boolean
  /** Delay after `session.start` before emitting completion events (default 5). */
  taskDelayMs?: number
  /**
   * Hold the session open until `session.abort` (no auto `session.end`).
   * Useful for abort smoke tests.
   */
  hangUntilAbort?: boolean
  /** After `session.started`, exit the child with a non-zero code. */
  crashAfterStart?: boolean
  crashExitCode?: number
  /** Emit a non-JSON stdout line before completing the session. */
  emitMalformedLine?: boolean
  /**
   * When set, on `session.start` write `outbox/<taskId>/status.json` under the
   * spawn `--cwd` (simulates Cowork outbox deliverable).
   */
  writeStatusForTaskId?: string
  /**
   * When set, on `session.message` write `outbox/<taskId>/status.json` and emit
   * another `session.end` (simulates the corrective status.json retry).
   */
  onMessageWriteStatusForTaskId?: string
  /** Optional text deltas to emit (default one short line). */
  textDeltas?: string[]
}

export type MockCoworkSpawnHandle = {
  spawnFn: CoworkSpawnFn
  getLastChild: () => MockCoworkChild | null
  /** Mutate behavior for subsequent sessions on the same child. */
  setBehavior: (next: MockCoworkChildBehavior) => void
}

function extractCwd(args: readonly string[]): string | null {
  const i = args.indexOf('--cwd')
  if (i < 0 || i + 1 >= args.length) return null
  return args[i + 1]!
}

function createMockChild(
  spawnArgs: readonly string[],
  getBehavior: () => MockCoworkChildBehavior,
): MockCoworkChild {
  const stdin = new PassThrough()
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  const ee = new EventEmitter() as MockCoworkChild

  let exitCode: number | null = null
  let signalCode: NodeJS.Signals | null = null
  let killed = false
  let sessionCounter = 0
  let activeSessionId: string | null = null
  let stdinBuf = ''

  Object.defineProperties(ee, {
    stdin: { value: stdin, enumerable: true },
    stdout: { value: stdout, enumerable: true },
    stderr: { value: stderr, enumerable: true },
    pid: { value: 9001, enumerable: true },
    spawnArgs: { value: spawnArgs, enumerable: true },
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
      exitCode = null
      queueMicrotask(() => ee.emit('exit', exitCode, signalCode))
    }
    return true
  }) as ChildProcess['kill']

  ee.emitLine = (obj: object) => {
    if (exitCode !== null || signalCode !== null) return
    stdout.write(JSON.stringify(obj) + '\n')
  }

  ee.exitWith = (code, signal = null) => {
    if (exitCode !== null || signalCode !== null) return
    exitCode = code
    signalCode = signal
    try {
      stdout.end()
    } catch {
      // ignore
    }
    try {
      stderr.end()
    } catch {
      // ignore
    }
    queueMicrotask(() => ee.emit('exit', code, signal))
  }

  const writeStatusFor = (taskId: string) => {
    const cwd = extractCwd(spawnArgs)
    if (!cwd) return
    const outDir = path.join(cwd, 'outbox', taskId)
    fs.mkdirSync(outDir, { recursive: true })
    const helloPath = path.join(outDir, 'hello.txt')
    fs.writeFileSync(helloPath, 'hello from mock cowork\n', 'utf8')
    fs.writeFileSync(
      path.join(outDir, 'status.json'),
      JSON.stringify({
        taskId,
        ok: true,
        files: ['hello.txt'],
        summary: 'mock cowork completed',
      }),
      'utf8',
    )
  }

  const writeStatusIfRequested = () => {
    const taskId = getBehavior().writeStatusForTaskId
    if (taskId) writeStatusFor(taskId)
  }

  const completeSession = (sessionId: string) => {
    const behavior = getBehavior()
    if (behavior.emitMalformedLine) {
      stdout.write('this is not json{{{\n')
    }
    writeStatusIfRequested()
    const deltas = behavior.textDeltas ?? ['mock cowork result']
    for (const text of deltas) {
      ee.emitLine({ type: 'agent.text_delta', sessionId, text })
    }
    ee.emitLine({ type: 'session.end', sessionId, result: 'ok' })
    activeSessionId = null
  }

  const handleCommand = (cmd: Record<string, unknown>) => {
    const type = cmd.type
    if (typeof type !== 'string') return

    if (type === 'session.start') {
      sessionCounter += 1
      const sessionId = `mock-sess-${sessionCounter}`
      activeSessionId = sessionId
      ee.emitLine({ type: 'session.started', sessionId })

      const behavior = getBehavior()
      if (behavior.crashAfterStart) {
        stderr.write('mock cowork fatal crash\n')
        setTimeout(() => {
          ee.exitWith(behavior.crashExitCode ?? 1)
        }, behavior.taskDelayMs ?? 5)
        return
      }

      if (behavior.hangUntilAbort) {
        // Wait for session.abort — optionally emit a partial delta.
        ee.emitLine({ type: 'agent.text_delta', sessionId, text: 'working…' })
        return
      }

      setTimeout(() => {
        if (activeSessionId !== sessionId) return
        completeSession(sessionId)
      }, behavior.taskDelayMs ?? 5)
      return
    }

    if (type === 'session.abort') {
      const sid = typeof cmd.sessionId === 'string' ? cmd.sessionId : activeSessionId
      if (!sid) return
      ee.emitLine({ type: 'session.end', sessionId: sid, result: 'aborted' })
      activeSessionId = null
      return
    }

    if (type === 'session.message') {
      // Acknowledge with a small delta if we have an active session.
      const sid =
        typeof cmd.sessionId === 'string' ? cmd.sessionId : activeSessionId
      if (sid) {
        ee.emitLine({
          type: 'agent.text_delta',
          sessionId: sid,
          text: String(cmd.text ?? ''),
        })
        const behavior = getBehavior()
        if (behavior.onMessageWriteStatusForTaskId) {
          writeStatusFor(behavior.onMessageWriteStatusForTaskId)
          ee.emitLine({ type: 'session.end', sessionId: sid, result: 'ok' })
        }
      }
    }
  }

  stdin.setEncoding('utf8')
  stdin.on('data', (chunk: string) => {
    stdinBuf += chunk
    for (;;) {
      const nl = stdinBuf.indexOf('\n')
      if (nl < 0) break
      const line = stdinBuf.slice(0, nl).replace(/\r$/, '')
      stdinBuf = stdinBuf.slice(nl + 1)
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        const parsed = JSON.parse(trimmed) as unknown
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          handleCommand(parsed as Record<string, unknown>)
        }
      } catch {
        stderr.write(`mock: bad stdin line: ${trimmed.slice(0, 80)}\n`)
      }
    }
  })

  // Emit ready after spawn (microtask / delay so CoworkClient attaches stdout first).
  const behavior0 = getBehavior()
  if (!behavior0.skipReady) {
    const delay = behavior0.readyDelayMs ?? 0
    setTimeout(() => {
      ee.emitLine({ type: 'stdio.ready' })
    }, delay)
  }

  return ee
}

/**
 * Build an injectable `spawnFn` that returns an autonomous JSONL mock child.
 */
export function createMockCoworkSpawn(
  initial: MockCoworkChildBehavior = {},
): MockCoworkSpawnHandle {
  let behavior: MockCoworkChildBehavior = { ...initial }
  let lastChild: MockCoworkChild | null = null

  const spawnFn: CoworkSpawnFn = (
    _command: string,
    args: readonly string[],
    _options?: SpawnOptions,
  ) => {
    lastChild = createMockChild(args, () => behavior)
    return lastChild
  }

  return {
    spawnFn,
    getLastChild: () => lastChild,
    setBehavior: (next) => {
      behavior = { ...behavior, ...next }
    },
  }
}
