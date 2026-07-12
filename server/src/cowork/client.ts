import { spawn as defaultSpawn, type ChildProcess } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { logger } from '../log'
import { JsonlLineBuffer, parseJsonlLine } from './jsonl'
import type {
  CoworkClientOptions,
  CoworkCommand,
  CoworkEvent,
  CoworkSpawnFn,
  CoworkStartOptions,
  CoworkTaskResult,
} from './types'

const log = logger.child({ component: 'cowork' })

const DEFAULT_WORKSPACE = 'C:/Users/dines/BMC/jarvis-cowork-workspace'
const STDERR_KEEP = 200
const READY_TIMEOUT_MS = 60_000
const DEFAULT_TASK_TIMEOUT_MS = 15 * 60_000

/** DB settings keys (precedence over env when set). */
export const COWORK_SETTING_EXE = 'cowork.exe'
export const COWORK_SETTING_WORKSPACE = 'cowork.workspace'

/** Official Windows installer / releases page. */
export const OPEN_COWORK_RELEASES_URL =
  'https://github.com/OpenCoworkAI/open-cowork/releases'
export const OPEN_COWORK_WIN_INSTALLER_URL =
  'https://github.com/OpenCoworkAI/open-cowork/releases/download/v3.3.1/Open.Cowork-3.3.1-win-x64.exe'

/** Windows installer default when env is unset (may not exist until Open Cowork is installed). */
export function defaultCoworkExeCandidate(): string {
  const localAppData =
    process.env.LOCALAPPDATA ||
    path.join(process.env.USERPROFILE ?? 'C:/Users', 'AppData', 'Local')
  // electron-builder productName "Open Cowork" → Programs\Open Cowork\
  // Older docs / some installs used Programs\open-cowork\
  const spaced = path.join(localAppData, 'Programs', 'Open Cowork', 'Open Cowork.exe')
  const kebab = path.join(localAppData, 'Programs', 'open-cowork', 'Open Cowork.exe')
  if (coworkExeExists(spaced)) return spaced
  if (coworkExeExists(kebab)) return kebab
  return spaced
}

/**
 * Resolve Open Cowork executable path.
 * Precedence: override → OPEN_COWORK_EXE → OPEN_COWORK_PATH → COWORK_EXE → Windows default candidate.
 * Callers that load `cowork.exe` from settings should pass it as `override`.
 */
export function resolveCoworkExe(override?: string): string {
  if (override?.trim()) return override.trim()
  const fromEnv =
    process.env.OPEN_COWORK_EXE?.trim() ||
    process.env.OPEN_COWORK_PATH?.trim() ||
    process.env.COWORK_EXE?.trim()
  if (fromEnv) return fromEnv
  return defaultCoworkExeCandidate()
}

export function resolveCoworkWorkspace(override?: string): string {
  if (override?.trim()) return override.trim()
  return process.env.OPEN_COWORK_WORKSPACE?.trim() || DEFAULT_WORKSPACE
}

export function coworkExeExists(exe: string): boolean {
  if (!exe.trim()) return false
  try {
    return fs.existsSync(exe) && fs.statSync(exe).isFile()
  } catch {
    return false
  }
}

export function formatCoworkExeMissingMessage(exe: string): string {
  const shown = exe.trim() || '(empty path)'
  return (
    `Open Cowork executable not found at "${shown}". ` +
    `Install the desktop app from ${OPEN_COWORK_RELEASES_URL}, then paste the path to ` +
    `"Open Cowork.exe" in Cowork → Setup (or set OPEN_COWORK_EXE / OPEN_COWORK_PATH / COWORK_EXE ` +
    `in the server .env and restart the API). ` +
    `Source under BMC/center/open-cowork is docs-only — it is not a runnable binary.`
  )
}

export type CoworkSetupInfo = {
  configured: boolean
  exe: string
  exeExists: boolean
  /** True when the installed binary includes headless JSONL (--headless / stdio.ready). */
  headlessSupported: boolean
  workspace: string
  hint: string
  downloadUrl: string
  releasesUrl: string
}

const headlessSupportCache = new Map<string, { mtimeMs: number; supported: boolean }>()

/**
 * Detect whether a packaged Open Cowork build includes headless JSONL CLI.
 * Released 3.3.x installers do not; main-branch / future builds do (`--headless`).
 *
 * Scans `resources/app.asar` with byte search (no full UTF-8 decode) and caches by mtime.
 */
export function coworkExeSupportsHeadless(exe: string): boolean {
  if (!exe.trim() || !coworkExeExists(exe)) return false
  try {
    const asar = path.join(path.dirname(exe), 'resources', 'app.asar')
    if (!fs.existsSync(asar)) {
      // Dev / unpackaged electron: assume source builds support headless.
      return true
    }
    const mtimeMs = fs.statSync(asar).mtimeMs
    const cached = headlessSupportCache.get(asar)
    if (cached && cached.mtimeMs === mtimeMs) return cached.supported

    const needleHeadless = Buffer.from('--headless')
    const needleReady = Buffer.from('stdio.ready')
    const fd = fs.openSync(asar, 'r')
    try {
      const size = fs.fstatSync(fd).size
      const chunkSize = 1024 * 1024
      const overlap = Math.max(needleHeadless.length, needleReady.length) - 1
      let offset = 0
      let prevTail = Buffer.alloc(0)
      let hasHeadless = false
      let hasReady = false
      while (offset < size && !(hasHeadless && hasReady)) {
        const toRead = Math.min(chunkSize, size - offset)
        const chunk = Buffer.alloc(toRead)
        fs.readSync(fd, chunk, 0, toRead, offset)
        const view =
          prevTail.length > 0 ? Buffer.concat([prevTail, chunk]) : chunk
        if (!hasHeadless && view.includes(needleHeadless)) hasHeadless = true
        if (!hasReady && view.includes(needleReady)) hasReady = true
        prevTail = view.subarray(Math.max(0, view.length - overlap))
        offset += toRead
      }
      const supported = hasHeadless && hasReady
      headlessSupportCache.set(asar, { mtimeMs, supported })
      return supported
    } finally {
      fs.closeSync(fd)
    }
  } catch {
    return false
  }
}

export function formatCoworkHeadlessUnsupportedMessage(exe: string): string {
  const shown = exe.trim() || '(empty path)'
  return (
    `Open Cowork at "${shown}" does not include headless JSONL (--headless / stdio.ready). ` +
    `Released 3.3.x installers are GUI-only; Hermes needs a build with Agent Platform headless ` +
    `(main branch / a newer release). Build from source or watch ${OPEN_COWORK_RELEASES_URL}. ` +
    `Task briefs are still written under the workspace inbox and audited in the database.`
  )
}

/** Snapshot for GET /api/cowork/setup and preflight checks. */
export function getCoworkSetupInfo(opts?: {
  exe?: string
  workspace?: string
}): CoworkSetupInfo {
  const exe = resolveCoworkExe(opts?.exe)
  const workspace = resolveCoworkWorkspace(opts?.workspace)
  const exeExists = coworkExeExists(exe)
  const headlessSupported = exeExists ? coworkExeSupportsHeadless(exe) : false
  let hint: string
  if (!exeExists) {
    hint = formatCoworkExeMissingMessage(exe)
  } else if (!headlessSupported) {
    hint = formatCoworkHeadlessUnsupportedMessage(exe)
  } else {
    hint = 'Open Cowork executable is ready for headless work requests.'
  }
  return {
    configured: exeExists && headlessSupported,
    exe,
    exeExists,
    headlessSupported,
    workspace,
    hint,
    downloadUrl: OPEN_COWORK_WIN_INSTALLER_URL,
    releasesUrl: OPEN_COWORK_RELEASES_URL,
  }
}

export class CoworkClient {
  private child: ChildProcess | null = null
  private ready: Promise<void> | null = null
  private stderrBuf: string[] = []
  private readonly listeners = new Set<(e: CoworkEvent) => void>()
  private readonly exe: string
  private workspace: string
  private readonly spawnFn: CoworkSpawnFn
  private readonly readyTimeoutMs: number
  /** Serialize runTask — one session at a time (§3.4). */
  private taskQueue: Promise<unknown> = Promise.resolve()
  private started = false
  private crashed: Error | null = null

  constructor(opts: CoworkClientOptions = {}) {
    this.exe = resolveCoworkExe(opts.exe)
    this.workspace = resolveCoworkWorkspace(opts.workspace)
    this.spawnFn = opts.spawnFn ?? defaultSpawn
    this.readyTimeoutMs = opts.readyTimeoutMs ?? READY_TIMEOUT_MS
  }

  get workspacePath(): string {
    return this.workspace
  }

  async start(opts: CoworkStartOptions = {}): Promise<void> {
    if (this.child) throw new Error('cowork: already started')

    const cwd = opts.cwd ?? this.workspace
    this.workspace = cwd
    this.crashed = null
    this.stderrBuf = []

    // Real spawn only — injected spawnFn (unit tests) may use a fake exe path.
    if (this.spawnFn === defaultSpawn && !coworkExeExists(this.exe)) {
      throw new Error(formatCoworkExeMissingMessage(this.exe))
    }

    const args = ['--headless', '--mode', 'stdio', '--cwd', cwd]
    if (opts.autoApprove) args.push('--auto-approve')

    this.child = this.spawnFn(this.exe, args, { stdio: ['pipe', 'pipe', 'pipe'] })
    const child = this.child

    // Never parse stderr as protocol; keep a rolling tail for failure reports.
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (d: string) => {
      this.stderrBuf.push(...d.split(/\r?\n/))
      if (this.stderrBuf.length > STDERR_KEEP) {
        this.stderrBuf.splice(0, this.stderrBuf.length - STDERR_KEEP)
      }
    })

    // CRITICAL: attach stdout reader before any stdin write (§3.7).
    const stdoutBuf = new JsonlLineBuffer()
    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      for (const line of stdoutBuf.push(chunk)) {
        this.handleStdoutLine(line)
      }
    })
    child.stdout?.on('end', () => {
      const left = stdoutBuf.flush()
      if (left.trim()) this.handleStdoutLine(left)
    })

    this.ready = new Promise<void>((resolve, reject) => {
      let settled = false
      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        const stderr = this.stderrTail()
        reject(
          new Error(
            `cowork: no stdio.ready within ${this.readyTimeoutMs}ms. ` +
              `Open Cowork must support headless JSONL (--headless --mode stdio). ` +
              `Install/upgrade from ${OPEN_COWORK_RELEASES_URL}, open the app once to finish setup ` +
              `(API keys), then retry. stderr: ${stderr || '(empty)'}`,
          ),
        )
      }, this.readyTimeoutMs)

      const onReady = (evt: CoworkEvent) => {
        if (evt.type !== 'stdio.ready' || settled) return
        settled = true
        clearTimeout(timer)
        this.listeners.delete(onReady)
        resolve()
      }
      this.listeners.add(onReady)

      child.once('exit', (code, signal) => {
        const err = new Error(
          `cowork exited before ready (code ${code}${signal ? ` signal ${signal}` : ''}): ${this.stderrTail()}`,
        )
        this.crashed = err
        this.started = false
        if (!settled) {
          settled = true
          clearTimeout(timer)
          this.listeners.delete(onReady)
          reject(err)
        }
      })

      child.once('error', (spawnErr) => {
        const raw = spawnErr.message || String(spawnErr)
        const isMissing =
          (spawnErr as NodeJS.ErrnoException).code === 'ENOENT' ||
          /ENOENT|no such file or directory/i.test(raw)
        const err = new Error(
          isMissing
            ? formatCoworkExeMissingMessage(this.exe)
            : `cowork spawn failed: ${raw}`,
        )
        this.crashed = err
        if (!settled) {
          settled = true
          clearTimeout(timer)
          this.listeners.delete(onReady)
          reject(err)
        }
      })
    })

    try {
      await this.ready
      this.started = true
    } catch (err) {
      this.started = false
      throw err
    }
  }

  /**
   * Run one task to completion. Calls are serialized (one session at a time).
   * Resolves on `session.end`; rejects on session-scoped error, timeout, or crash.
   */
  async runTask(
    taskId: string,
    prompt: string,
    timeoutMs = DEFAULT_TASK_TIMEOUT_MS,
  ): Promise<CoworkTaskResult> {
    const run = () => this.runTaskInner(taskId, prompt, timeoutMs)
    const next = this.taskQueue.then(run, run)
    this.taskQueue = next.then(
      () => undefined,
      () => undefined,
    )
    return next
  }

  private async runTaskInner(
    taskId: string,
    prompt: string,
    timeoutMs: number,
  ): Promise<CoworkTaskResult> {
    if (!this.child?.stdin?.writable || !this.started) {
      throw new Error('cowork not started')
    }
    if (this.crashed) throw this.crashed

    const events: CoworkEvent[] = []
    let sessionId: string | null = null
    let resultText = ''
    let logPath: string | null = null

    try {
      const candidate = path.join(this.workspace, 'logs', `${taskId}.jsonl`)
      fs.mkdirSync(path.dirname(candidate), { recursive: true })
      fs.accessSync(path.dirname(candidate), fs.constants.W_OK)
      logPath = candidate
    } catch (err) {
      log.warn('cowork: workspace logs not writable; skipping event log file', {
        workspace: this.workspace,
        error: err,
      })
      logPath = null
    }

    const writeLog = (evt: CoworkEvent) => {
      if (!logPath) return
      try {
        fs.appendFileSync(logPath, JSON.stringify({ ts: Date.now(), taskId, ...evt }) + '\n')
      } catch {
        // ignore write failures mid-task; disable further attempts
        logPath = null
      }
    }

    const done = new Promise<void>((resolve, reject) => {
      let settled = false
      const finish = (fn: () => void) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        this.listeners.delete(onEvent)
        childExitCleanup()
        fn()
      }

      const timer = setTimeout(() => {
        if (sessionId) {
          try {
            this.send({ type: 'session.abort', sessionId })
          } catch {
            // ignore
          }
        }
        finish(() => reject(new Error(`cowork task ${taskId} timed out after ${timeoutMs}ms`)))
      }, timeoutMs)

      const onEvent = (evt: CoworkEvent) => {
        events.push(evt)
        writeLog(evt)
        switch (evt.type) {
          case 'session.started':
            if (!sessionId) sessionId = typeof evt.sessionId === 'string' ? evt.sessionId : null
            break
          case 'agent.text_delta':
            if (evt.sessionId === sessionId) resultText += String(evt.text ?? '')
            break
          case 'session.end':
            if (evt.sessionId === sessionId) finish(() => resolve())
            break
          case 'error':
            // Session-scoped errors end the task; protocol errors without sessionId are non-fatal.
            if (evt.sessionId && evt.sessionId === sessionId) {
              finish(() => reject(new Error(`cowork error: ${evt.message ?? 'unknown'}`)))
            }
            break
        }
      }

      const onChildExit = (code: number | null, signal: NodeJS.Signals | null) => {
        const err = new Error(
          `cowork crashed during task ${taskId} (code ${code}${signal ? ` signal ${signal}` : ''}): ${this.stderrTail()}`,
        )
        this.crashed = err
        this.started = false
        finish(() => reject(err))
      }

      const child = this.child!
      child.once('exit', onChildExit)
      const childExitCleanup = () => {
        child.off('exit', onChildExit)
      }

      this.listeners.add(onEvent)
    })

    this.send({ type: 'session.start', prompt })

    await done

    let status: unknown
    const statusPath = path.join(this.workspace, 'outbox', taskId, 'status.json')
    if (fs.existsSync(statusPath)) {
      try {
        status = JSON.parse(fs.readFileSync(statusPath, 'utf8'))
      } catch (err) {
        log.warn('cowork: malformed status.json', { statusPath, error: err })
      }
    }

    const ok =
      typeof status === 'object' && status !== null && (status as { ok?: boolean }).ok === true

    return {
      ok,
      sessionId,
      resultText,
      events,
      status,
      exitCode: this.child?.exitCode ?? null,
      stderrTail: this.stderrTail(),
    }
  }

  async stop(graceMs = 10_000): Promise<void> {
    if (!this.child) return
    const child = this.child
    try {
      child.stdin?.end()
    } catch {
      // ignore
    }
    const exited = new Promise<void>((r) => child.once('exit', () => r()))
    await Promise.race([exited, new Promise<void>((r) => setTimeout(r, graceMs))])
    if (child.exitCode === null && child.signalCode === null) {
      try {
        child.kill()
      } catch {
        // ignore
      }
    }
    try {
      child.stdout?.destroy()
      child.stderr?.destroy()
    } catch {
      // ignore
    }
    this.child = null
    this.started = false
    this.ready = null
    this.listeners.clear()
  }

  send(msg: CoworkCommand | object): void {
    if (!this.child?.stdin?.writable) throw new Error('cowork not started')
    this.child.stdin.write(JSON.stringify(msg) + '\n')
  }

  onEvent(fn: (e: CoworkEvent) => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  stderrTail(n = 20): string {
    return this.stderrBuf.slice(-n).join('\n')
  }

  private handleStdoutLine(line: string): void {
    const parsed = parseJsonlLine(line)
    if (!parsed.ok) {
      if (parsed.reason === 'malformed') {
        log.warn('cowork: unparseable stdout line', { line: parsed.line.slice(0, 200) })
        this.stderrBuf.push(`[jarvis] unparseable stdout line: ${parsed.line.slice(0, 200)}`)
        if (this.stderrBuf.length > STDERR_KEEP) {
          this.stderrBuf.splice(0, this.stderrBuf.length - STDERR_KEEP)
        }
      }
      return
    }
    for (const fn of this.listeners) {
      try {
        fn(parsed.value)
      } catch (err) {
        log.error('cowork: event listener threw', { error: err })
      }
    }
  }
}
