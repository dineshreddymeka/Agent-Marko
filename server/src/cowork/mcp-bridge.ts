/**
 * Jarvis MCP bridge (Phase 2 Slice B + Phase 4 contract guardrails).
 *
 * ## Bidirectional contract (boundaries)
 *
 * **Cowork → Hermes (MCP tools exposed):** exactly three purpose-built tools —
 * not the Hermes agent tool registry, not MCP-proxied third-party tools, and
 * not provider/`delegate_to_agent` surfaces:
 *   - `jarvis_report_progress` — mid-task progress
 *   - `jarvis_ask`              — clarifying question (non-blocking ack)
 *   - `jarvis_fetch_context`    — read-only settings/memory snippets
 *
 * **Hermes → Cowork (durable run events):** bridge writes only
 *   - `COWORK_PROGRESS`
 *   - `COWORK_QUESTION`
 * against the task audit session. No other event types and no secret values.
 *
 * **Safety:** sensitive settings keys are refused; memory snippets are
 * redacted; progress events are rate/volume capped; inputs are validated.
 *
 * The bridge typically runs as its own bun process spawned by Open Cowork
 * (see mcp-bridge-main.ts + mcp-register.ts), so DB persistence — not the
 * in-memory maps — is what the Hermes API/UI actually observes.
 */
import { existsSync } from 'node:fs'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { logger } from '../log'
import type { RunEventRecord } from '../db/repositories/run_events'
import { coworkSessionTitle } from './persist'
import {
  appendCoworkTaskProgress,
  appendCoworkTaskQuestion,
  getCoworkTaskRecord,
  type CoworkTaskProgressEntry,
  type CoworkTaskQuestion,
} from './run-task'

const log = logger.child({ component: 'cowork-mcp-bridge' })

export const JARVIS_MCP_BRIDGE_NAME = 'jarvis-mcp-bridge'
export const JARVIS_MCP_BRIDGE_VERSION = '0.1.0'

/** Tools Hermes exposes to Open Cowork over this bridge (closed set). */
export const JARVIS_MCP_BRIDGE_TOOLS = [
  'jarvis_report_progress',
  'jarvis_ask',
  'jarvis_fetch_context',
] as const

export type JarvisMcpBridgeToolName = (typeof JARVIS_MCP_BRIDGE_TOOLS)[number]

/** run_events types written by the bridge (own runId per event, seq 1). */
export const COWORK_PROGRESS_EVENT = 'COWORK_PROGRESS'
export const COWORK_QUESTION_EVENT = 'COWORK_QUESTION'

/** Bridge-persisted event types only — nothing else crosses this boundary. */
export const JARVIS_MCP_PERSISTED_EVENTS = [
  COWORK_PROGRESS_EVENT,
  COWORK_QUESTION_EVENT,
] as const

/** Settings keys that must never leave the process via jarvis_fetch_context. */
export const SENSITIVE_BRIDGE_KEY =
  /(token|secret|password|passwd|credential|api[_-]?key|authorization|bearer|cookie)/i

/** Safe task id for bridge calls (path-safe; production ids are `t-YYYYMMDD-NNN`). */
export const BRIDGE_TASK_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/

export const BRIDGE_PROGRESS_MESSAGE_MAX = 500
export const BRIDGE_ASK_QUESTION_MAX = 1_000
export const BRIDGE_CONTEXT_QUERY_MAX = 200
export const BRIDGE_CONTEXT_KEY_MAX = 128
export const BRIDGE_CONTEXT_MATCH_CONTENT_MAX = 500
export const BRIDGE_CONTEXT_MATCH_LIMIT_MAX = 20

/** Max progress events accepted per task within the rolling window. */
export const BRIDGE_PROGRESS_RATE_MAX = 30
export const BRIDGE_PROGRESS_RATE_WINDOW_MS = 60_000

/** Soft volume cap before refusing further progress for a task (in-process). */
export const BRIDGE_PROGRESS_VOLUME_MAX = 100

export type BridgeHandlerOptions = {
  /** Skip DB persistence (unit tests). Default true. */
  persist?: boolean
}

export type ReportProgressInput = {
  taskId: string
  message: string
  /** 0–100 when the worker can estimate completion. */
  percent?: number
}

export type ReportProgressResult = {
  ok: boolean
  taskId: string
  entry: CoworkTaskProgressEntry
  /** Whether the task is known to this process's in-memory map. */
  taskKnown: boolean
  persisted: boolean
}

export type AskInput = {
  taskId: string
  question: string
}

export type AskResult = {
  ok: boolean
  taskId: string
  questionId: string
  /** The bridge never blocks on an answer — workers should continue with stated assumptions. */
  answered: false
  hint: string
  persisted: boolean
}

export type FetchContextInput = {
  /** Exact settings key (sensitive keys are refused). */
  key?: string
  /** Case-insensitive substring match over memory entries. */
  query?: string
  limit?: number
}

export type FetchContextResult = {
  ok: boolean
  key: string | null
  setting: unknown
  matches: Array<{ id: string; kind: string; content: string }>
  /** Present when the request was refused or invalid. */
  error?: string
  code?: string
  refused?: boolean
}

export class BridgeContractError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'BridgeContractError'
    this.code = code
  }
}

/** Per-task timestamps of accepted progress events (rate limiting). */
const progressRateLog = new Map<string, number[]>()
/** Per-task count of accepted progress events in this process. */
const progressVolume = new Map<string, number>()
/** Last successful bridge handler activity (process-local readiness signal). */
let lastBridgeActivityAt: string | null = null

export function getLastJarvisMcpBridgeActivityAt(): string | null {
  return lastBridgeActivityAt
}

export function resetJarvisMcpBridgeGuardrailsForTests(): void {
  progressRateLog.clear()
  progressVolume.clear()
  lastBridgeActivityAt = null
}

/** Clears only the rolling rate window (keeps volume + activity) — test helper. */
export function clearJarvisMcpBridgeRateWindowForTests(): void {
  progressRateLog.clear()
}

function touchBridgeActivity(): void {
  lastBridgeActivityAt = new Date().toISOString()
}

export function isSensitiveBridgeKey(key: string): boolean {
  return SENSITIVE_BRIDGE_KEY.test(key)
}

export function assertBridgeTaskId(taskId: string): string {
  const trimmed = taskId?.trim() ?? ''
  if (!trimmed) {
    throw new BridgeContractError('TASK_ID_REQUIRED', 'taskId is required')
  }
  if (trimmed.includes('..') || trimmed.includes('/') || trimmed.includes('\\') || trimmed.includes('\0')) {
    throw new BridgeContractError('TASK_ID_INVALID', 'taskId contains unsafe path characters')
  }
  if (!BRIDGE_TASK_ID_RE.test(trimmed)) {
    throw new BridgeContractError(
      'TASK_ID_INVALID',
      'taskId must be 1–64 chars of [A-Za-z0-9._-] (e.g. t-20260712-001)',
    )
  }
  return trimmed
}

function assertBoundedString(
  value: string | undefined,
  field: string,
  codeRequired: string,
  max: number,
): string {
  const trimmed = value?.trim() ?? ''
  if (!trimmed) {
    throw new BridgeContractError(codeRequired, `${field} is required`)
  }
  if (trimmed.length > max) {
    throw new BridgeContractError(
      'INPUT_TOO_LONG',
      `${field} exceeds maximum length of ${max} characters`,
    )
  }
  return trimmed
}

function enforceProgressRateAndVolume(taskId: string): void {
  const volume = progressVolume.get(taskId) ?? 0
  if (volume >= BRIDGE_PROGRESS_VOLUME_MAX) {
    throw new BridgeContractError(
      'PROGRESS_VOLUME_EXCEEDED',
      `Progress volume cap exceeded for task (${BRIDGE_PROGRESS_VOLUME_MAX} events)`,
    )
  }

  const now = Date.now()
  const windowStart = now - BRIDGE_PROGRESS_RATE_WINDOW_MS
  const prior = (progressRateLog.get(taskId) ?? []).filter((t) => t >= windowStart)
  if (prior.length >= BRIDGE_PROGRESS_RATE_MAX) {
    throw new BridgeContractError(
      'PROGRESS_RATE_EXCEEDED',
      `Progress rate cap exceeded (${BRIDGE_PROGRESS_RATE_MAX} events per ${BRIDGE_PROGRESS_RATE_WINDOW_MS / 1000}s)`,
    )
  }
  prior.push(now)
  progressRateLog.set(taskId, prior)
  progressVolume.set(taskId, volume + 1)
}

/** Redact secret-shaped substrings from memory content returned to Cowork. */
export function redactBridgeContextContent(content: string): string {
  let out = content
  // Common API key / bearer shapes
  out = out.replace(/\b(sk-[A-Za-z0-9_-]{8,})\b/g, '[REDACTED]')
  out = out.replace(/\b(Bearer\s+)[A-Za-z0-9._\-+=/]{8,}/gi, '$1[REDACTED]')
  out = out.replace(
    /\b(api[_-]?key|token|secret|password)\s*[:=]\s*["']?[^\s"']{6,}["']?/gi,
    '$1=[REDACTED]',
  )
  if (out.length > BRIDGE_CONTEXT_MATCH_CONTENT_MAX) {
    out = out.slice(0, BRIDGE_CONTEXT_MATCH_CONTENT_MAX)
  }
  return out
}

/**
 * Persist one bridge event into run_events against the task's audit session
 * (`Cowork: <taskId>`). Own runId per event, seq 1 — no clash with the
 * begin/finish audit counters. Best-effort: returns false when the DB or the
 * session is unavailable.
 */
async function persistBridgeEvent(
  taskId: string,
  eventType: string,
  payload: Record<string, unknown>,
): Promise<boolean> {
  if (
    eventType !== COWORK_PROGRESS_EVENT &&
    eventType !== COWORK_QUESTION_EVENT
  ) {
    log.warn('refusing to persist non-contract bridge event', { taskId, eventType })
    return false
  }
  try {
    const [{ sessionsRepo }, { runEventsRepo }] = await Promise.all([
      import('../db/repositories/sessions'),
      import('../db/repositories/run_events'),
    ])
    let sessionId = getCoworkTaskRecord(taskId)?.sessionId ?? null
    if (!sessionId) {
      const title = coworkSessionTitle(taskId)
      const found = await sessionsRepo.search(title, 5)
      sessionId = found.find((s) => s.title === title)?.id ?? null
    }
    if (!sessionId) return false
    await runEventsRepo.append({
      runId: crypto.randomUUID(),
      sessionId,
      seq: 1,
      eventType,
      payload,
    })
    return true
  } catch (err) {
    log.debug('bridge event persist skipped', { taskId, eventType, error: err })
    return false
  }
}

/** `jarvis_report_progress` — record mid-task progress for a task. */
export async function handleReportProgress(
  input: ReportProgressInput,
  opts: BridgeHandlerOptions = {},
): Promise<ReportProgressResult> {
  const taskId = assertBridgeTaskId(input.taskId)
  const message = assertBoundedString(
    input.message,
    'message',
    'MESSAGE_REQUIRED',
    BRIDGE_PROGRESS_MESSAGE_MAX,
  )
  if (input.percent !== undefined && input.percent !== null) {
    if (typeof input.percent !== 'number' || !Number.isFinite(input.percent)) {
      throw new BridgeContractError('PERCENT_INVALID', 'percent must be a finite number')
    }
  }
  const percent =
    typeof input.percent === 'number' && Number.isFinite(input.percent)
      ? Math.max(0, Math.min(100, input.percent))
      : undefined

  enforceProgressRateAndVolume(taskId)

  const entry = appendCoworkTaskProgress(taskId, message, percent)
  const persisted =
    opts.persist !== false
      ? await persistBridgeEvent(taskId, COWORK_PROGRESS_EVENT, {
          taskId,
          message,
          ...(percent !== undefined ? { percent } : {}),
          at: entry.at,
        })
      : false

  touchBridgeActivity()
  return {
    ok: true,
    taskId,
    entry,
    taskKnown: getCoworkTaskRecord(taskId) !== undefined,
    persisted,
  }
}

/** `jarvis_ask` — store a clarifying question; ack immediately, never block. */
export async function handleAsk(
  input: AskInput,
  opts: BridgeHandlerOptions = {},
): Promise<AskResult> {
  const taskId = assertBridgeTaskId(input.taskId)
  const question = assertBoundedString(
    input.question,
    'question',
    'QUESTION_REQUIRED',
    BRIDGE_ASK_QUESTION_MAX,
  )

  const entry = appendCoworkTaskQuestion(taskId, question)
  const persisted =
    opts.persist !== false
      ? await persistBridgeEvent(taskId, COWORK_QUESTION_EVENT, {
          taskId,
          questionId: entry.id,
          question,
          at: entry.at,
        })
      : false

  touchBridgeActivity()
  return {
    ok: true,
    taskId,
    questionId: entry.id,
    answered: false,
    hint:
      'Question recorded for Jarvis/human review. Do not wait for an answer — ' +
      'continue with your best assumption and state it in the deliverable.',
    persisted,
  }
}

/**
 * `jarvis_fetch_context` — read-only lookup of a settings value by key and/or
 * memory entries by substring query. Returns a safe empty result when the DB
 * is unavailable or nothing matches. Sensitive keys are explicitly refused.
 */
export async function handleFetchContext(
  input: FetchContextInput,
): Promise<FetchContextResult> {
  const keyRaw = input.key?.trim() || null
  const queryRaw = input.query?.trim() || null

  if (!keyRaw && !queryRaw) {
    return {
      ok: false,
      key: null,
      setting: null,
      matches: [],
      refused: true,
      code: 'KEY_OR_QUERY_REQUIRED',
      error: 'Provide a settings key and/or a memory query',
    }
  }

  if (keyRaw && keyRaw.length > BRIDGE_CONTEXT_KEY_MAX) {
    return {
      ok: false,
      key: keyRaw.slice(0, BRIDGE_CONTEXT_KEY_MAX),
      setting: null,
      matches: [],
      refused: true,
      code: 'INPUT_TOO_LONG',
      error: `key exceeds maximum length of ${BRIDGE_CONTEXT_KEY_MAX} characters`,
    }
  }

  if (queryRaw && queryRaw.length > BRIDGE_CONTEXT_QUERY_MAX) {
    return {
      ok: false,
      key: keyRaw,
      setting: null,
      matches: [],
      refused: true,
      code: 'INPUT_TOO_LONG',
      error: `query exceeds maximum length of ${BRIDGE_CONTEXT_QUERY_MAX} characters`,
    }
  }

  const key = keyRaw
  const query = queryRaw
  const limit = Math.max(
    1,
    Math.min(
      BRIDGE_CONTEXT_MATCH_LIMIT_MAX,
      typeof input.limit === 'number' && Number.isFinite(input.limit)
        ? Math.floor(input.limit)
        : 5,
    ),
  )

  if (key && isSensitiveBridgeKey(key)) {
    touchBridgeActivity()
    return {
      ok: false,
      key,
      setting: null,
      matches: [],
      refused: true,
      code: 'SENSITIVE_KEY_REFUSED',
      error: 'Sensitive settings keys cannot be fetched via the Jarvis MCP bridge',
    }
  }

  const result: FetchContextResult = { ok: true, key, setting: null, matches: [] }

  if (key) {
    try {
      const { settingsRepo } = await import('../db/repositories/settings')
      const value = await settingsRepo.get(key)
      // Defense in depth: never return object values that look secret-keyed.
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const scrubbed: Record<string, unknown> = {}
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
          scrubbed[k] = isSensitiveBridgeKey(k) ? '[REDACTED]' : v
        }
        result.setting = scrubbed
      } else if (typeof value === 'string') {
        result.setting = redactBridgeContextContent(value)
      } else {
        result.setting = value ?? null
      }
    } catch {
      // DB optional — safe empty result
    }
  }

  if (query) {
    try {
      const { memoryRepo } = await import('../db/repositories/memory')
      const entries = await memoryRepo.list({ limit: 100 })
      const q = query.toLowerCase()
      result.matches = entries
        .filter((e) => e.content.toLowerCase().includes(q))
        .slice(0, limit)
        .map((e) => ({
          id: e.id,
          kind: e.kind,
          content: redactBridgeContextContent(e.content),
        }))
    } catch {
      // DB optional — safe empty result
    }
  }

  touchBridgeActivity()
  return result
}

/** Extract bridge progress/question entries from persisted run_events. */
export function bridgeEntriesFromEvents(
  events: Pick<RunEventRecord, 'eventType' | 'payload' | 'createdAt'>[],
): { progress: CoworkTaskProgressEntry[]; questions: CoworkTaskQuestion[] } {
  const progress: CoworkTaskProgressEntry[] = []
  const questions: CoworkTaskQuestion[] = []
  for (const evt of events) {
    const payload =
      evt.payload && typeof evt.payload === 'object' && !Array.isArray(evt.payload)
        ? (evt.payload as Record<string, unknown>)
        : {}
    if (evt.eventType === COWORK_PROGRESS_EVENT) {
      if (typeof payload.message !== 'string') continue
      progress.push({
        at: typeof payload.at === 'string' ? payload.at : evt.createdAt,
        message: payload.message,
        ...(typeof payload.percent === 'number' ? { percent: payload.percent } : {}),
      })
    } else if (evt.eventType === COWORK_QUESTION_EVENT) {
      if (typeof payload.question !== 'string') continue
      questions.push({
        id: typeof payload.questionId === 'string' ? payload.questionId : crypto.randomUUID(),
        question: payload.question,
        at: typeof payload.at === 'string' ? payload.at : evt.createdAt,
      })
    }
  }
  return { progress, questions }
}

function textResult(value: unknown, isError = false) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(value) }],
    ...(isError ? { isError: true as const } : {}),
  }
}

async function toolGuard<T>(fn: () => Promise<T>): Promise<ReturnType<typeof textResult>> {
  try {
    return textResult(await fn())
  } catch (err) {
    if (err instanceof BridgeContractError) {
      return textResult({ ok: false, code: err.code, error: err.message }, true)
    }
    const message = err instanceof Error ? err.message : String(err)
    return textResult({ ok: false, code: 'BRIDGE_ERROR', error: message }, true)
  }
}

/** Build the minimal Jarvis MCP server (three tools, no Hermes registry). */
export function createJarvisMcpBridgeServer(): McpServer {
  const mcp = new McpServer({
    name: JARVIS_MCP_BRIDGE_NAME,
    version: JARVIS_MCP_BRIDGE_VERSION,
  })

  mcp.registerTool(
    'jarvis_report_progress',
    {
      description:
        'Report mid-task progress on a Jarvis task so the orchestrator UI can show it. ' +
        'Call this at meaningful milestones during long tasks. Rate-limited.',
      inputSchema: {
        taskId: z.string().describe('Jarvis task id from the brief (e.g. t-20260712-001)'),
        message: z
          .string()
          .max(BRIDGE_PROGRESS_MESSAGE_MAX)
          .describe('Short human-readable progress update'),
        percent: z.number().min(0).max(100).optional().describe('Estimated completion 0-100'),
      },
    },
    async ({ taskId, message, percent }) =>
      toolGuard(() => handleReportProgress({ taskId, message, percent })),
  )

  mcp.registerTool(
    'jarvis_ask',
    {
      description:
        'Store a clarifying question about a Jarvis task for later human/Jarvis review. ' +
        'Returns an ack + question id immediately — never waits for an answer, so ' +
        'continue with your best assumption after calling this.',
      inputSchema: {
        taskId: z.string().describe('Jarvis task id from the brief'),
        question: z.string().max(BRIDGE_ASK_QUESTION_MAX).describe('The clarifying question'),
      },
    },
    async ({ taskId, question }) => toolGuard(() => handleAsk({ taskId, question })),
  )

  mcp.registerTool(
    'jarvis_fetch_context',
    {
      description:
        'Read-only: fetch a short Jarvis context snippet — a settings value by exact key ' +
        'and/or memory entries matching a query. Sensitive keys are refused. ' +
        'Returns an empty result when nothing matches.',
      inputSchema: {
        key: z.string().max(BRIDGE_CONTEXT_KEY_MAX).optional().describe('Exact settings key (sensitive keys refused)'),
        query: z
          .string()
          .max(BRIDGE_CONTEXT_QUERY_MAX)
          .optional()
          .describe('Substring to match against memory entries'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(BRIDGE_CONTEXT_MATCH_LIMIT_MAX)
          .optional()
          .describe('Max memory matches (default 5)'),
      },
    },
    async ({ key, query, limit }) =>
      toolGuard(async () => {
        const result = await handleFetchContext({ key, query, limit })
        if (result.refused) {
          // Surface refusal as MCP tool error while keeping structured body.
          throw new BridgeContractError(result.code ?? 'REFUSED', result.error ?? 'Refused')
        }
        return result
      }),
  )

  return mcp
}

/** Connect the bridge server over stdio (blocks until the transport closes). */
export async function startJarvisMcpBridge(): Promise<McpServer> {
  const mcp = createJarvisMcpBridgeServer()
  await mcp.connect(new StdioServerTransport())
  return mcp
}

/** True when the bridge CLI entry file is present on disk. */
export function jarvisBridgeScriptExists(scriptPath: string): boolean {
  try {
    return existsSync(scriptPath)
  } catch {
    return false
  }
}
