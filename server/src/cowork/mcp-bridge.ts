/**
 * Jarvis MCP bridge (Phase 2, Slice B).
 *
 * Direction: Jarvis = MCP **server** (stdio); Open Cowork = MCP client.
 * Deliberately minimal — three purpose-built tools, NOT the full Hermes
 * tool registry:
 *
 *   - jarvis_report_progress  mid-task progress → in-memory task record +
 *                             durable COWORK_PROGRESS run_event
 *   - jarvis_ask              store a clarifying question; returns an ack +
 *                             question id (never blocks the MCP call)
 *   - jarvis_fetch_context    read-only settings/memory snippet lookup;
 *                             safe empty result when nothing matches
 *
 * The bridge typically runs as its own bun process spawned by Open Cowork
 * (see mcp-bridge-main.ts + mcp-register.ts), so DB persistence — not the
 * in-memory maps — is what the Hermes API/UI actually observes.
 */
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

/** run_events types written by the bridge (own runId per event, seq 1). */
export const COWORK_PROGRESS_EVENT = 'COWORK_PROGRESS'
export const COWORK_QUESTION_EVENT = 'COWORK_QUESTION'

/** Settings keys that must never leave the process via jarvis_fetch_context. */
const SENSITIVE_KEY = /(token|secret|password|passwd|credential|api[_-]?key)/i

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
  const taskId = input.taskId?.trim()
  const message = input.message?.trim()
  if (!taskId) throw new Error('taskId is required')
  if (!message) throw new Error('message is required')
  const percent =
    typeof input.percent === 'number' && Number.isFinite(input.percent)
      ? Math.max(0, Math.min(100, input.percent))
      : undefined

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
  const taskId = input.taskId?.trim()
  const question = input.question?.trim()
  if (!taskId) throw new Error('taskId is required')
  if (!question) throw new Error('question is required')

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
 * is unavailable or nothing matches.
 */
export async function handleFetchContext(
  input: FetchContextInput,
): Promise<FetchContextResult> {
  const key = input.key?.trim() || null
  const query = input.query?.trim() || null
  const limit = Math.max(1, Math.min(20, input.limit ?? 5))

  const result: FetchContextResult = { ok: true, key, setting: null, matches: [] }

  if (key && !SENSITIVE_KEY.test(key)) {
    try {
      const { settingsRepo } = await import('../db/repositories/settings')
      result.setting = (await settingsRepo.get(key)) ?? null
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
          content: e.content.slice(0, 500),
        }))
    } catch {
      // DB optional — safe empty result
    }
  }

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

function textResult(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value) }] }
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
        'Call this at meaningful milestones during long tasks.',
      inputSchema: {
        taskId: z.string().describe('Jarvis task id from the brief (e.g. t-20260712-001)'),
        message: z.string().describe('Short human-readable progress update'),
        percent: z.number().min(0).max(100).optional().describe('Estimated completion 0-100'),
      },
    },
    async ({ taskId, message, percent }) =>
      textResult(await handleReportProgress({ taskId, message, percent })),
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
        question: z.string().describe('The clarifying question'),
      },
    },
    async ({ taskId, question }) => textResult(await handleAsk({ taskId, question })),
  )

  mcp.registerTool(
    'jarvis_fetch_context',
    {
      description:
        'Read-only: fetch a short Jarvis context snippet — a settings value by exact key ' +
        'and/or memory entries matching a query. Returns an empty result when nothing matches.',
      inputSchema: {
        key: z.string().optional().describe('Exact settings key (sensitive keys refused)'),
        query: z.string().optional().describe('Substring to match against memory entries'),
        limit: z.number().int().min(1).max(20).optional().describe('Max memory matches (default 5)'),
      },
    },
    async ({ key, query, limit }) =>
      textResult(await handleFetchContext({ key, query, limit })),
  )

  return mcp
}

/** Connect the bridge server over stdio (blocks until the transport closes). */
export async function startJarvisMcpBridge(): Promise<McpServer> {
  const mcp = createJarvisMcpBridgeServer()
  await mcp.connect(new StdioServerTransport())
  return mcp
}
