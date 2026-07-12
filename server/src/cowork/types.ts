import type { ChildProcess, SpawnOptions } from 'node:child_process'

/** One JSONL protocol event from Open Cowork stdout. */
export type CoworkEvent = {
  type: string
  sessionId?: string
  message?: string
  text?: string
  tool?: string
  input?: unknown
  output?: unknown
  result?: unknown
  payload?: unknown
  [key: string]: unknown
}

export type CoworkTaskResult = {
  ok: boolean
  sessionId: string | null
  /** Concatenated `agent.text_delta` text for the session. */
  resultText: string
  /** Full event log for the task (also optionally persisted under logs/). */
  events: CoworkEvent[]
  /** Parsed `outbox/<taskId>/status.json` when present. */
  status?: unknown
  exitCode: number | null
  stderrTail: string
}

export type CoworkStartOptions = {
  autoApprove?: boolean
  /** Workspace root passed as `--cwd`. Defaults to env / jarvis workspace. */
  cwd?: string
}

export type CoworkClientOptions = {
  /** Override executable path (else OPEN_COWORK_EXE / OPEN_COWORK_PATH / COWORK_EXE / Windows default). */
  exe?: string
  /** Default workspace when start() omits cwd. */
  workspace?: string
  /** Injectable spawn for unit tests. */
  spawnFn?: CoworkSpawnFn
  /** Timeout waiting for `stdio.ready` (default 60s). */
  readyTimeoutMs?: number
}

export type CoworkSpawnFn = (
  command: string,
  args: readonly string[],
  options?: SpawnOptions,
) => ChildProcess

export type CoworkCommand =
  | { type: 'session.start'; prompt: string; cwd?: string }
  | { type: 'session.message'; sessionId: string; text: string }
  | { type: 'session.abort'; sessionId: string }
