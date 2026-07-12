/**
 * Persist Open Cowork task audits using existing Hermes tables.
 * Session title convention: `Cowork: <taskId>`; event log in `run_events`.
 *
 * Insert contract: every run_event carries session_id + created_at + jsonb payload.
 * COWORK_STARTED / COWORK_FINISHED shapes — see docs/DATABASE-DESIGN.md.
 */
import type { CoworkDeliverableType, CoworkTask, CoworkTaskStatus } from '@hermes/shared'
import { sessionsRepo } from '../db/repositories/sessions'
import { runEventsRepo, type RunEventRecord } from '../db/repositories/run_events'
import type { CoworkEvent } from './types'

export function coworkSessionTitle(taskId: string): string {
  return `Cowork: ${taskId}`
}

export type CoworkStartedPayload = {
  taskId: string
  goal?: string
  deliverableType?: CoworkDeliverableType | string
  inputFiles?: unknown[]
  autoApprove?: boolean
  [key: string]: unknown
}

export type CoworkFinishedPayload = {
  taskId: string
  status: CoworkTaskStatus
  ok?: boolean
  files?: string[]
  summary?: string | null
  error?: string | null
  [key: string]: unknown
}

export type PersistCoworkAuditInput = {
  taskId: string
  /** Defaults to a new UUID — use one run_id for the whole task audit trail. */
  runId?: string
  events?: CoworkEvent[]
  ok?: boolean
  status?: CoworkTaskStatus
  /** Extra payload fields merged into start/finish events. */
  meta?: Record<string, unknown>
}

export type PersistCoworkAuditResult = {
  sessionId: string
  runId: string
  eventCount: number
}

export type BeginCoworkAuditInput = {
  taskId: string
  runId?: string
  meta?: Record<string, unknown>
}

export type BeginCoworkAuditResult = {
  sessionId: string
  runId: string
  seq: number
}

export type FinishCoworkAuditInput = {
  sessionId: string
  runId: string
  taskId: string
  /** Next seq after STARTED (default 2). */
  nextSeq?: number
  events?: CoworkEvent[]
  ok?: boolean
  status?: CoworkTaskStatus
  meta?: Record<string, unknown>
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return null
}

function deriveStatus(opts: {
  ok?: boolean
  status?: CoworkTaskStatus
  aborted?: boolean
}): CoworkTaskStatus {
  if (opts.status) return opts.status
  if (opts.aborted) return 'aborted'
  return opts.ok ? 'done' : 'failed'
}

/**
 * Create `Cowork: <taskId>` session and append COWORK_STARTED (seq 1).
 * Call at task start so the chat audit link works mid-run.
 */
export async function beginCoworkAudit(
  input: BeginCoworkAuditInput,
): Promise<BeginCoworkAuditResult> {
  const runId = input.runId ?? crypto.randomUUID()
  const session = await sessionsRepo.create({
    title: coworkSessionTitle(input.taskId),
  })

  const started: CoworkStartedPayload = {
    taskId: input.taskId,
    ...input.meta,
  }

  await runEventsRepo.append({
    runId,
    sessionId: session.id,
    seq: 1,
    eventType: 'COWORK_STARTED',
    payload: started,
  })

  void import('../indexer/service')
    .then(({ queueCoworkTaskIndex }) =>
      queueCoworkTaskIndex(input.taskId, { sessionId: session.id, runId }),
    )
    .catch((err) => {
      void import('../log').then(({ logger }) =>
        logger.warn('Failed to queue cowork_task index', { taskId: input.taskId, error: String(err) }),
      )
    })

  return { sessionId: session.id, runId, seq: 1 }
}

/**
 * Append streamed events + COWORK_FINISHED for an existing audit trail.
 */
export async function finishCoworkAudit(
  input: FinishCoworkAuditInput,
): Promise<{ eventCount: number }> {
  let seq = (input.nextSeq ?? 2) - 1
  for (const evt of input.events ?? []) {
    await runEventsRepo.append({
      runId: input.runId,
      sessionId: input.sessionId,
      seq: ++seq,
      eventType: evt.type || 'COWORK_EVENT',
      payload: evt,
    })
  }

  const status = deriveStatus({
    ok: input.ok,
    status: input.status,
    aborted: Boolean(input.meta?.aborted),
  })

  const finished: CoworkFinishedPayload = {
    taskId: input.taskId,
    status,
    ok: input.ok ?? status === 'done',
    ...input.meta,
  }

  await runEventsRepo.append({
    runId: input.runId,
    sessionId: input.sessionId,
    seq: ++seq,
    eventType: 'COWORK_FINISHED',
    payload: finished,
  })

  const files = Array.isArray(finished.files)
    ? finished.files.filter((f): f is string => typeof f === 'string')
    : []
  void import('../indexer/service')
    .then(({ queueCoworkTaskIndex }) =>
      queueCoworkTaskIndex(input.taskId, {
        sessionId: input.sessionId,
        runId: input.runId,
        files,
      }),
    )
    .catch((err) => {
      void import('../log').then(({ logger }) =>
        logger.warn('Failed to queue cowork_task/office_artifact index', {
          taskId: input.taskId,
          error: String(err),
        }),
      )
    })

  return { eventCount: seq }
}

/**
 * Create a session titled `Cowork: <taskId>` and append start + events + finish.
 * Convenience for tests / one-shot persist; prefer begin+finish at runtime.
 */
export async function persistCoworkAudit(
  input: PersistCoworkAuditInput,
): Promise<PersistCoworkAuditResult> {
  const begun = await beginCoworkAudit({
    taskId: input.taskId,
    runId: input.runId,
    meta: input.meta,
  })

  const finished = await finishCoworkAudit({
    sessionId: begun.sessionId,
    runId: begun.runId,
    taskId: input.taskId,
    nextSeq: begun.seq + 1,
    events: input.events,
    ok: input.ok,
    status: input.status,
    meta: input.meta,
  })

  return {
    sessionId: begun.sessionId,
    runId: begun.runId,
    eventCount: finished.eventCount,
  }
}

/**
 * Rebuild a CoworkTask from run_events payloads (survives process restart).
 * STARTED without FINISHED and no live process → failed ("Interrupted by server restart").
 */
export function restoreCoworkTaskFromEvents(
  taskId: string,
  sessionId: string,
  events: Pick<RunEventRecord, 'eventType' | 'payload' | 'createdAt'>[],
  opts?: {
    /** Session timestamps as fallback dates. */
    sessionCreatedAt?: string
    sessionUpdatedAt?: string
    /** Disk status.json fallback when events lack finish fields. */
    statusJson?: {
      ok?: boolean
      files?: string[]
      summary?: string
      error?: string
    } | null
  },
): CoworkTask {
  const started = events.find((e) => e.eventType === 'COWORK_STARTED')
  const finished = events.find((e) => e.eventType === 'COWORK_FINISHED')
  const startPayload = asRecord(started?.payload) ?? {}
  const finishPayload = asRecord(finished?.payload) ?? {}
  const statusJson = opts?.statusJson ?? null

  const goal =
    (typeof startPayload.goal === 'string' ? startPayload.goal : null) ??
    (typeof finishPayload.goal === 'string' ? finishPayload.goal : null)

  const deliverableTypeRaw =
    startPayload.deliverableType ?? finishPayload.deliverableType ?? null
  const deliverableType =
    typeof deliverableTypeRaw === 'string'
      ? (deliverableTypeRaw as CoworkDeliverableType)
      : null

  /** Null when STARTED lacked `inputFiles` (legacy); otherwise source paths. */
  let inputFiles: string[] | null = null
  if ('inputFiles' in startPayload) {
    inputFiles = []
    const raw = startPayload.inputFiles
    if (Array.isArray(raw)) {
      for (const item of raw) {
        if (typeof item === 'string' && item.trim()) {
          inputFiles.push(item.trim())
        } else if (
          item &&
          typeof item === 'object' &&
          typeof (item as { sourcePath?: unknown }).sourcePath === 'string'
        ) {
          const p = (item as { sourcePath: string }).sourcePath.trim()
          if (p) inputFiles.push(p)
        }
      }
    }
  }

  let status: CoworkTaskStatus
  let error: string | null = null
  let summary: string | null = null
  let files: string[] = []
  let finishedAt: string | null = null

  if (finished) {
    const statusRaw = finishPayload.status
    if (
      statusRaw === 'done' ||
      statusRaw === 'failed' ||
      statusRaw === 'aborted' ||
      statusRaw === 'queued' ||
      statusRaw === 'running'
    ) {
      status = statusRaw
    } else if (finishPayload.ok === true) {
      status = 'done'
    } else if (finishPayload.aborted === true) {
      status = 'aborted'
    } else {
      status = 'failed'
    }
    summary =
      typeof finishPayload.summary === 'string'
        ? finishPayload.summary
        : typeof statusJson?.summary === 'string'
          ? statusJson.summary
          : null
    error =
      typeof finishPayload.error === 'string'
        ? finishPayload.error
        : typeof statusJson?.error === 'string'
          ? statusJson.error
          : null
    if (Array.isArray(finishPayload.files)) {
      files = finishPayload.files.filter((f): f is string => typeof f === 'string')
    } else if (Array.isArray(statusJson?.files)) {
      files = statusJson!.files.map((f) =>
        f.startsWith('outbox/') ? f : `outbox/${taskId}/${f}`,
      )
    }
    finishedAt = finished.createdAt
  } else if (started) {
    status = 'failed'
    error = 'Interrupted by server restart'
    finishedAt = opts?.sessionUpdatedAt ?? started.createdAt
    if (Array.isArray(statusJson?.files)) {
      files = statusJson!.files.map((f) =>
        f.startsWith('outbox/') ? f : `outbox/${taskId}/${f}`,
      )
    }
    if (typeof statusJson?.summary === 'string') summary = statusJson.summary
  } else if (statusJson) {
    status = statusJson.ok === true ? 'done' : 'failed'
    summary = typeof statusJson.summary === 'string' ? statusJson.summary : null
    error =
      typeof statusJson.error === 'string'
        ? statusJson.error
        : statusJson.ok === false
          ? 'Task reported failure'
          : null
    files = Array.isArray(statusJson.files)
      ? statusJson.files.map((f) =>
          f.startsWith('outbox/') ? f : `outbox/${taskId}/${f}`,
        )
      : []
    finishedAt = opts?.sessionUpdatedAt ?? null
  } else {
    status = 'failed'
    error = 'No status.json yet'
    finishedAt = opts?.sessionUpdatedAt ?? null
  }

  return {
    taskId,
    status,
    goal,
    deliverableType,
    sessionId,
    inputFiles,
    files,
    summary,
    error,
    createdAt: started?.createdAt ?? opts?.sessionCreatedAt ?? new Date(0).toISOString(),
    finishedAt,
  }
}
