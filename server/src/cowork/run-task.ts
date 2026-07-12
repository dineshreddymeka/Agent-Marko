/**
 * Shared Open Cowork task runner used by `delegate_to_cowork` and REST `/api/cowork/tasks`.
 */
import { readdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type {
  CoworkDeliverableType,
  CoworkTask,
  CoworkTaskStatus,
} from '@hermes/shared'
import { config } from '../config'
import { logger } from '../log'
import {
  CoworkClient,
  COWORK_SETTING_EXE,
  COWORK_SETTING_WORKSPACE,
  coworkExeExists,
  coworkExeSupportsHeadless,
  formatCoworkHeadlessUnsupportedMessage,
  resolveCoworkExe,
} from './client'
import { beginCoworkAudit, finishCoworkAudit } from './persist'
import { validateStatus } from './status'
import {
  generateTaskId,
  packageTask,
  type PackageFileInput,
  type PackagedTask,
} from './task'
import type { CoworkClientOptions, CoworkTaskResult } from './types'
import { ensureDirs } from './workspace'

const log = logger.child({ component: 'cowork-run-task' })

/** In-memory active clients for best-effort abort (process-local). */
const activeClients = new Map<
  string,
  { client: CoworkClient; coworkSessionId: string | null }
>()

/** In-memory task records for running/recent jobs (survives until process restart). */
const taskRecords = new Map<string, CoworkTask>()

/** Mid-task progress reported via the Jarvis MCP bridge (`jarvis_report_progress`). */
const taskProgress = new Map<string, CoworkTaskProgressEntry[]>()

/** Clarifying questions stored via the Jarvis MCP bridge (`jarvis_ask`). */
const taskQuestions = new Map<string, CoworkTaskQuestion[]>()

/** Cap per-task progress/question lists so a chatty worker cannot grow unbounded. */
const BRIDGE_ENTRIES_MAX = 200

export type CoworkTaskProgressEntry = {
  at: string
  message: string
  percent?: number
}

export type CoworkTaskQuestion = {
  id: string
  question: string
  at: string
}

export type RunCoworkTaskInput = {
  goal: string
  files?: PackageFileInput[]
  autoApprove?: boolean
  deliverableType?: CoworkDeliverableType
  /** Pre-chosen task id (otherwise generated). */
  taskId?: string
  workspace?: string
  /** Open Cowork.exe override (settings / REST). */
  exe?: string
  timeoutMs?: number
  /** Skip DB audit persist (tests). Default true. */
  persist?: boolean
  /** Injectable client factory for unit tests. */
  createClient?: (opts: CoworkClientOptions) => CoworkClient
}

export type RunCoworkTaskResult = {
  taskId: string
  ok: boolean
  status: CoworkTaskStatus
  statusJson: unknown
  files: string[]
  summary: string | null
  validationError: string | null
  /** Open Cowork protocol session id. */
  coworkSessionId: string | null
  /** Hermes audit session id (`Cowork: <taskId>`). */
  sessionId: string | null
  resultText: string
  eventCount: number
  exitCode: number | null
  stderrTail: string
  briefPath: string
  prompt: string
  deliverableType: CoworkDeliverableType | null
  goal: string
  createdAt: string
  finishedAt: string | null
}

/** Map business deliverable chips to a short prompt appendix with concrete outbox names. */
export function deliverablePromptAppendix(
  type: CoworkDeliverableType,
  taskId: string,
): string {
  const out = `outbox/${taskId}`
  switch (type) {
    case 'presentation':
      return `Produce a PowerPoint presentation under \`${out}/\` (e.g. \`deck.pptx\`).`
    case 'word':
      return `Produce a Word document under \`${out}/\` (e.g. \`report.docx\`).`
    case 'spreadsheet':
      return `Produce an Excel spreadsheet under \`${out}/\` (e.g. \`data.xlsx\`).`
    case 'pdf':
      return `Produce a PDF under \`${out}/\` (e.g. \`report.pdf\`).`
    case 'other':
      return `Produce the requested deliverable under \`${out}/\` with a predictable filename.`
    default: {
      const _exhaustive: never = type
      return _exhaustive
    }
  }
}

export function buildGoalWithDeliverable(
  goal: string,
  deliverableType: CoworkDeliverableType | undefined,
  taskId: string,
): string {
  const trimmed = goal.trim()
  if (!deliverableType) return trimmed
  return `${trimmed}\n\n${deliverablePromptAppendix(deliverableType, taskId)}`
}

/**
 * Resolve workspace root: explicit override → settings `cowork.workspace` → env/default.
 * Used by REST and `delegate_to_cowork` (via runCoworkTask with no workspace passed).
 */
export async function resolveCoworkWorkspace(override?: string): Promise<string> {
  if (override?.trim()) return resolve(override.trim())
  try {
    const { settingsRepo } = await import('../db/repositories/settings')
    const raw = await settingsRepo.get(COWORK_SETTING_WORKSPACE)
    if (typeof raw === 'string' && raw.trim()) return resolve(raw.trim())
  } catch {
    // DB optional at unit-test time
  }
  return resolve(config.OPEN_COWORK_WORKSPACE)
}

function upsertRecord(partial: CoworkTask): CoworkTask {
  const prev = taskRecords.get(partial.taskId)
  const next: CoworkTask = { ...prev, ...partial }
  taskRecords.set(partial.taskId, next)
  return next
}

export function getCoworkTaskRecord(taskId: string): CoworkTask | undefined {
  return taskRecords.get(taskId)
}

/**
 * Append a mid-task progress entry (Jarvis MCP bridge). Works even when the
 * task record lives in another process — the in-memory list is best-effort;
 * durable visibility comes from the COWORK_PROGRESS run_event.
 */
export function appendCoworkTaskProgress(
  taskId: string,
  message: string,
  percent?: number,
): CoworkTaskProgressEntry {
  const entry: CoworkTaskProgressEntry = {
    at: new Date().toISOString(),
    message,
    ...(percent !== undefined ? { percent } : {}),
  }
  const list = taskProgress.get(taskId) ?? []
  list.push(entry)
  if (list.length > BRIDGE_ENTRIES_MAX) list.splice(0, list.length - BRIDGE_ENTRIES_MAX)
  taskProgress.set(taskId, list)
  return entry
}

export function listCoworkTaskProgress(taskId: string): CoworkTaskProgressEntry[] {
  return taskProgress.get(taskId) ?? []
}

/** Store a clarifying question for a task (Jarvis MCP bridge `jarvis_ask`). */
export function appendCoworkTaskQuestion(
  taskId: string,
  question: string,
): CoworkTaskQuestion {
  const entry: CoworkTaskQuestion = {
    id: crypto.randomUUID(),
    question,
    at: new Date().toISOString(),
  }
  const list = taskQuestions.get(taskId) ?? []
  list.push(entry)
  if (list.length > BRIDGE_ENTRIES_MAX) list.splice(0, list.length - BRIDGE_ENTRIES_MAX)
  taskQuestions.set(taskId, list)
  return entry
}

export function listCoworkTaskQuestions(taskId: string): CoworkTaskQuestion[] {
  return taskQuestions.get(taskId) ?? []
}

export function listCoworkTaskRecords(): CoworkTask[] {
  return [...taskRecords.values()].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  )
}

export function getActiveCoworkClient(
  taskId: string,
): CoworkClient | undefined {
  return activeClients.get(taskId)?.client
}

/**
 * Best-effort abort: send `session.abort` when session id is known, else stop the child.
 */
export async function abortCoworkTask(
  taskId: string,
): Promise<{ ok: boolean; status: CoworkTaskStatus; error?: string }> {
  const entry = activeClients.get(taskId)
  const record = taskRecords.get(taskId)

  if (!entry) {
    const status = record?.status ?? 'failed'
    return {
      ok: false,
      status,
      error: 'No active Cowork process for this task',
    }
  }

  const { client, coworkSessionId } = entry
  try {
    if (coworkSessionId) {
      client.send({ type: 'session.abort', sessionId: coworkSessionId })
    } else {
      await client.stop(2_000)
    }
  } catch (err) {
    return {
      ok: false,
      status: record?.status ?? 'running',
      error: err instanceof Error ? err.message : String(err),
    }
  }

  upsertRecord({
    taskId,
    status: 'aborted',
    goal: record?.goal ?? null,
    deliverableType: record?.deliverableType ?? null,
    sessionId: record?.sessionId ?? null,
    inputFiles: record?.inputFiles ?? null,
    files: record?.files ?? [],
    summary: record?.summary ?? null,
    error: 'Aborted by user',
    createdAt: record?.createdAt ?? new Date().toISOString(),
    finishedAt: new Date().toISOString(),
  })

  return { ok: true, status: 'aborted' }
}

export async function listOutboxFiles(
  workspaceRoot: string,
  taskId: string,
): Promise<string[]> {
  const dir = join(workspaceRoot, 'outbox', taskId)
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    return entries.filter((e) => e.isFile()).map((e) => e.name)
  } catch {
    return []
  }
}

export async function readStatusJson(
  workspaceRoot: string,
  taskId: string,
): Promise<Record<string, unknown> | null> {
  try {
    const raw = await readFile(
      join(workspaceRoot, 'outbox', taskId, 'status.json'),
      'utf8',
    )
    const parsed = JSON.parse(raw) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
    return null
  } catch {
    return null
  }
}

/**
 * Run one packaged Cowork task to completion (tool + REST shared path).
 */
export async function runCoworkTask(
  input: RunCoworkTaskInput,
): Promise<RunCoworkTaskResult> {
  const goal = input.goal.trim()
  if (!goal) throw new Error('goal is required')

  const workspace = await resolveCoworkWorkspace(input.workspace)
  await ensureDirs(workspace)

  const taskId = input.taskId ?? generateTaskId()
  const instruction = buildGoalWithDeliverable(
    goal,
    input.deliverableType,
    taskId,
  )
  const createdAt = new Date().toISOString()
  const inputFilesMeta =
    input.files?.map((f) => ({ sourcePath: f.sourcePath, name: f.name })) ?? []
  const inputFilesPaths = inputFilesMeta.map((f) => f.sourcePath)

  upsertRecord({
    taskId,
    status: 'queued',
    goal,
    deliverableType: input.deliverableType ?? null,
    sessionId: null,
    inputFiles: inputFilesPaths,
    files: [],
    summary: null,
    error: null,
    createdAt,
    finishedAt: null,
  })

  let hermesSessionId: string | null = null
  let auditRunId: string | null = null

  if (input.persist !== false) {
    try {
      const begun = await beginCoworkAudit({
        taskId,
        meta: {
          goal,
          deliverableType: input.deliverableType,
          inputFiles: inputFilesMeta,
          autoApprove:
            input.autoApprove !== undefined
              ? input.autoApprove
              : config.OPEN_COWORK_AUTO_APPROVE,
          source: 'run-task',
        },
      })
      hermesSessionId = begun.sessionId
      auditRunId = begun.runId
      upsertRecord({
        ...(taskRecords.get(taskId) as CoworkTask),
        sessionId: hermesSessionId,
      })
    } catch (persistErr) {
      log.warn('cowork: begin audit failed', { taskId, error: persistErr })
    }
  }

  let packaged: PackagedTask
  try {
    packaged = await packageTask(workspace, instruction, input.files, {
      taskId,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    upsertRecord({
      taskId,
      status: 'failed',
      goal,
      deliverableType: input.deliverableType ?? null,
      sessionId: hermesSessionId,
      inputFiles: inputFilesPaths,
      files: [],
      summary: null,
      error: message,
      createdAt,
      finishedAt: new Date().toISOString(),
    })
    if (hermesSessionId && auditRunId && input.persist !== false) {
      try {
        await finishCoworkAudit({
          sessionId: hermesSessionId,
          runId: auditRunId,
          taskId,
          ok: false,
          status: 'failed',
          meta: {
            goal,
            deliverableType: input.deliverableType,
            error: message,
            source: 'run-task',
          },
        })
      } catch (persistErr) {
        log.warn('cowork: finish audit after package failure failed', {
          taskId,
          error: persistErr,
        })
      }
    }
    throw err
  }

  upsertRecord({
    taskId,
    status: 'running',
    goal,
    deliverableType: input.deliverableType ?? null,
    sessionId: hermesSessionId,
    inputFiles: inputFilesPaths,
    files: [],
    summary: null,
    error: null,
    createdAt,
    finishedAt: null,
  })

  const createClient =
    input.createClient ?? ((opts: CoworkClientOptions) => new CoworkClient(opts))

  let settingsExe: string | undefined
  try {
    const { settingsRepo } = await import('../db/repositories/settings')
    const raw = await settingsRepo.get(COWORK_SETTING_EXE)
    if (typeof raw === 'string' && raw.trim()) settingsExe = raw.trim()
  } catch {
    // DB optional at unit-test time
  }

  const exe = resolveCoworkExe(
    input.exe ?? settingsExe ?? (config.OPEN_COWORK_EXE || undefined),
  )

  if (
    !input.createClient &&
    coworkExeExists(exe) &&
    !coworkExeSupportsHeadless(exe)
  ) {
    const message = formatCoworkHeadlessUnsupportedMessage(exe)
    const finishedAt = new Date().toISOString()
    upsertRecord({
      taskId,
      status: 'failed',
      goal,
      deliverableType: input.deliverableType ?? null,
      sessionId: hermesSessionId,
      inputFiles: inputFilesPaths,
      files: [],
      summary: null,
      error: message,
      createdAt,
      finishedAt,
    })
    if (hermesSessionId && auditRunId && input.persist !== false) {
      try {
        await finishCoworkAudit({
          sessionId: hermesSessionId,
          runId: auditRunId,
          taskId,
          ok: false,
          status: 'failed',
          events: [],
          meta: {
            goal,
            deliverableType: input.deliverableType,
            files: [],
            summary: null,
            error: message,
            source: 'run-task',
          },
        })
      } catch (persistErr) {
        log.warn('cowork: persist audit failed', { taskId, error: persistErr })
      }
    }
    throw new Error(message)
  }

  const client = createClient({
    exe,
    workspace,
  })

  activeClients.set(taskId, { client, coworkSessionId: null })
  const unsub = client.onEvent((evt) => {
    if (evt.type === 'session.started' && typeof evt.sessionId === 'string') {
      const cur = activeClients.get(taskId)
      if (cur) activeClients.set(taskId, { ...cur, coworkSessionId: evt.sessionId })
    }
  })

  const autoApprove =
    input.autoApprove !== undefined
      ? input.autoApprove
      : config.OPEN_COWORK_AUTO_APPROVE
  const timeoutMs = input.timeoutMs ?? config.OPEN_COWORK_TIMEOUT_MS

  let taskResult: CoworkTaskResult
  try {
    await client.start({ autoApprove, cwd: workspace })
    taskResult = await client.runTask(packaged.taskId, packaged.prompt, timeoutMs)
  } catch (err) {
    unsub()
    activeClients.delete(taskId)
    try {
      await client.stop(2_000)
    } catch {
      // ignore
    }
    const message = err instanceof Error ? err.message : String(err)
    const finishedAt = new Date().toISOString()
    const prior = taskRecords.get(taskId)
    const status: CoworkTaskStatus =
      prior?.status === 'aborted' ? 'aborted' : 'failed'
    upsertRecord({
      taskId,
      status,
      goal,
      deliverableType: input.deliverableType ?? null,
      sessionId: hermesSessionId ?? prior?.sessionId ?? null,
      inputFiles: prior?.inputFiles ?? inputFilesPaths,
      files: prior?.files ?? [],
      summary: prior?.summary ?? null,
      error: prior?.status === 'aborted' ? prior.error ?? 'Aborted by user' : message,
      createdAt,
      finishedAt,
    })

    if (hermesSessionId && auditRunId && input.persist !== false) {
      try {
        await finishCoworkAudit({
          sessionId: hermesSessionId,
          runId: auditRunId,
          taskId,
          ok: false,
          status,
          meta: {
            goal,
            deliverableType: input.deliverableType,
            error: message,
            aborted: status === 'aborted',
            source: 'run-task',
          },
        })
      } catch (persistErr) {
        log.warn('cowork: persist after failure failed', { taskId, error: persistErr })
      }
    }

    throw err
  }

  unsub()
  activeClients.delete(taskId)

  try {
    await client.stop(2_000)
  } catch {
    // non-fatal
  }

  const validation = await validateStatus(workspace, packaged.taskId)
  const outboxRelFiles =
    validation.status?.files?.map((f) => `outbox/${packaged.taskId}/${f}`) ?? []
  const summary =
    (validation.status && typeof validation.status.summary === 'string'
      ? validation.status.summary
      : null) ??
    (taskResult.resultText ? taskResult.resultText.slice(0, 2000) : null)
  const ok = validation.ok && taskResult.ok
  const status: CoworkTaskStatus = ok
    ? 'done'
    : taskRecords.get(taskId)?.status === 'aborted'
      ? 'aborted'
      : 'failed'
  const validationError = validation.ok ? null : validation.error
  const finishedAt = new Date().toISOString()

  if (hermesSessionId && auditRunId && input.persist !== false) {
    try {
      await finishCoworkAudit({
        sessionId: hermesSessionId,
        runId: auditRunId,
        taskId,
        ok,
        status,
        events: taskResult.events,
        meta: {
          goal,
          deliverableType: input.deliverableType,
          files: outboxRelFiles,
          summary,
          error: validationError,
          validationError,
          source: 'run-task',
        },
      })
    } catch (persistErr) {
      log.warn('cowork: persist audit failed', { taskId, error: persistErr })
    }
  }

  upsertRecord({
    taskId,
    status,
    goal,
    deliverableType: input.deliverableType ?? null,
    sessionId: hermesSessionId,
    inputFiles: inputFilesPaths,
    files: outboxRelFiles,
    summary,
    error: validationError,
    createdAt,
    finishedAt,
  })

  return {
    taskId: packaged.taskId,
    ok,
    status,
    statusJson: validation.status ?? taskResult.status ?? null,
    files: outboxRelFiles,
    summary,
    validationError,
    coworkSessionId: taskResult.sessionId,
    sessionId: hermesSessionId,
    resultText: taskResult.resultText,
    eventCount: taskResult.events.length,
    exitCode: taskResult.exitCode,
    stderrTail: taskResult.stderrTail,
    briefPath: packaged.briefPath,
    prompt: packaged.prompt,
    deliverableType: input.deliverableType ?? null,
    goal,
    createdAt,
    finishedAt,
  }
}

/**
 * Package + kick off `runCoworkTask` in the background (REST).
 * Returns immediately with `queued` status.
 */
export async function startCoworkTaskAsync(
  input: RunCoworkTaskInput,
): Promise<{ taskId: string; status: CoworkTaskStatus; createdAt: string }> {
  const goal = input.goal.trim()
  if (!goal) throw new Error('goal is required')

  const workspace = await resolveCoworkWorkspace(input.workspace)
  await ensureDirs(workspace)

  const taskId = input.taskId ?? generateTaskId()
  const createdAt = new Date().toISOString()
  const inputFilesPaths = input.files?.map((f) => f.sourcePath) ?? []

  upsertRecord({
    taskId,
    status: 'queued',
    goal,
    deliverableType: input.deliverableType ?? null,
    sessionId: null,
    inputFiles: inputFilesPaths,
    files: [],
    summary: null,
    error: null,
    createdAt,
    finishedAt: null,
  })

  // Fire-and-forget; errors land on the in-memory record.
  void runCoworkTask({ ...input, taskId }).catch((err) => {
    log.warn('cowork: background task failed', {
      taskId,
      error: err instanceof Error ? err.message : String(err),
    })
  })

  return { taskId, status: 'queued', createdAt }
}

/** Clear in-memory maps (unit tests). */
export function resetCoworkTaskStateForTests(): void {
  activeClients.clear()
  taskRecords.clear()
  taskProgress.clear()
  taskQuestions.clear()
}
