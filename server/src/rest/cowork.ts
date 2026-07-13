/**
 * REST handlers for Open Cowork work requests.
 * Mounted at `/api/cowork`.
 */
import type {
  AbortCoworkTaskResponse,
  CoworkDeliverableType,
  CoworkSetupResponse,
  CoworkTask,
  CoworkTaskDetail,
  CreateCoworkTaskBody,
  CreateCoworkTaskResponse,
  SendCoworkTaskMessageBody,
  SendCoworkTaskMessageResponse,
  UpdateCoworkSetupBody,
} from '@hermes/shared'
import { resolve } from 'node:path'
import { config } from '../config'
import {
  COWORK_SETTING_EXE,
  COWORK_SETTING_WORKSPACE,
  getCoworkSetupInfo,
} from '../cowork/client'
import { coworkSessionTitle, restoreCoworkTaskFromEvents } from '../cowork/persist'
import { bridgeEntriesFromEvents } from '../cowork/mcp-bridge'
import {
  getJarvisMcpBridgeStatus,
  registerJarvisMcpBridge,
} from '../cowork/mcp-register'
import {
  abortCoworkTask,
  getCoworkTaskRecord,
  listCoworkTaskProgress,
  listCoworkTaskQuestions,
  listCoworkTaskRecords,
  listOutboxFiles,
  readStatusJson,
  sendCoworkTaskMessage,
  startCoworkTaskAsync,
} from '../cowork/run-task'
import type { PackageFileInput } from '../cowork/task'
import { runEventsRepo } from '../db/repositories/run_events'
import { sessionsRepo } from '../db/repositories/sessions'
import { jsonResponse, parseJson } from './helpers'
import { requireDatabaseOrResponse, withDatabase } from './db-guard'
import { allowDbPathSettings, isEnvSet } from '../paths'

async function loadCoworkPathOverrides(): Promise<{ exe?: string; workspace?: string }> {
  try {
    const { settingsRepo } = await import('../db/repositories/settings')
    const [exeRaw, wsRaw] = await Promise.all([
      withDatabase(() => settingsRepo.get(COWORK_SETTING_EXE), null),
      allowDbPathSettings() && !isEnvSet('OPEN_COWORK_WORKSPACE')
        ? withDatabase(() => settingsRepo.get(COWORK_SETTING_WORKSPACE), null)
        : Promise.resolve(null),
    ])
    const exe = typeof exeRaw === 'string' && exeRaw.trim() ? exeRaw.trim() : undefined
    const workspace =
      typeof wsRaw === 'string' && wsRaw.trim() ? wsRaw.trim() : undefined
    return {
      exe: exe ?? (config.OPEN_COWORK_EXE || undefined),
      workspace: workspace ?? config.OPEN_COWORK_WORKSPACE,
    }
  } catch {
    return {
      exe: config.OPEN_COWORK_EXE || undefined,
      workspace: config.OPEN_COWORK_WORKSPACE,
    }
  }
}

function setupPayload(
  info: ReturnType<typeof getCoworkSetupInfo>,
): CoworkSetupResponse {
  let code: CoworkSetupResponse['code']
  if (!info.exeExists) code = 'COWORK_EXE_MISSING'
  else if (!info.headlessSupported) code = 'COWORK_HEADLESS_UNSUPPORTED'
  return {
    configured: info.configured,
    exe: info.exe,
    exeExists: info.exeExists,
    headlessSupported: info.headlessSupported,
    workspace: info.workspace,
    hint: info.hint,
    releasesUrl: info.releasesUrl,
    downloadUrl: info.downloadUrl,
    code,
  }
}

const DELIVERABLE_TYPES = new Set<CoworkDeliverableType>([
  'presentation',
  'word',
  'spreadsheet',
  'pdf',
  'other',
])

function parseTaskIdFromTitle(title: string): string | null {
  const m = /^Cowork:\s*(.+)$/.exec(title.trim())
  return m?.[1]?.trim() || null
}

function parseFilesBody(
  raw: CreateCoworkTaskBody['files'],
): PackageFileInput[] | undefined {
  if (raw == null) return undefined
  if (!Array.isArray(raw)) throw new Error('files must be an array')
  return raw.map((item, i) => {
    if (typeof item === 'string') return { sourcePath: item }
    if (
      item &&
      typeof item === 'object' &&
      typeof (item as { sourcePath?: unknown }).sourcePath === 'string'
    ) {
      const obj = item as { sourcePath: string; name?: string }
      return { sourcePath: obj.sourcePath, name: obj.name }
    }
    throw new Error(`files[${i}] must be a string path or { sourcePath, name? }`)
  })
}

async function tasksFromDb(
  limit = 50,
  workspaceRoot: string,
): Promise<CoworkTask[]> {
  const sessions = await withDatabase(
    () => sessionsRepo.search('Cowork:', limit),
    [],
  )
  const workspace = resolve(workspaceRoot)
  const out: CoworkTask[] = []

  for (const session of sessions) {
    const taskId = parseTaskIdFromTitle(session.title)
    if (!taskId) continue
    // Prefer live in-memory record when present.
    const live = getCoworkTaskRecord(taskId)
    if (live) {
      out.push({ ...live, sessionId: live.sessionId ?? session.id })
      continue
    }

    const statusJson = await readStatusJson(workspace, taskId)
    const events = await withDatabase(
      () => runEventsRepo.listBySession(session.id),
      [],
    )
    out.push(
      restoreCoworkTaskFromEvents(taskId, session.id, events, {
        sessionCreatedAt: session.createdAt,
        sessionUpdatedAt: session.updatedAt,
        statusJson: statusJson as {
          ok?: boolean
          files?: string[]
          summary?: string
          error?: string
        } | null,
      }),
    )
  }

  return out
}

function mergeTaskLists(memory: CoworkTask[], db: CoworkTask[]): CoworkTask[] {
  const byId = new Map<string, CoworkTask>()
  for (const t of db) byId.set(t.taskId, t)
  for (const t of memory) byId.set(t.taskId, t) // memory wins
  return [...byId.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export async function handleCowork(req: Request, path: string): Promise<Response | null> {
  const parts = path.split('/').filter(Boolean)
  // parts: ['api', 'cowork', 'tasks', ...?]  or ['api', 'cowork', 'setup']

  if (parts[0] !== 'api' || parts[1] !== 'cowork') return null

  // GET /api/cowork/setup — exe/workspace readiness (never throws ENOENT to the client).
  if (req.method === 'GET' && parts.length === 3 && parts[2] === 'setup') {
    const overrides = await loadCoworkPathOverrides()
    const mcpBridge = await getJarvisMcpBridgeStatus()
    return jsonResponse({
      ...setupPayload(getCoworkSetupInfo(overrides)),
      mcpBridge,
    })
  }

  // POST /api/cowork/mcp-bridge/register — upsert the Jarvis MCP server entry
  // into Open Cowork's mcp-config.json (register with Cowork closed, then start it).
  if (
    req.method === 'POST' &&
    parts.length === 4 &&
    parts[2] === 'mcp-bridge' &&
    parts[3] === 'register'
  ) {
    try {
      const mcpBridge = await registerJarvisMcpBridge()
      return jsonResponse({ ok: true, mcpBridge })
    } catch (err) {
      return jsonResponse(
        { error: err instanceof Error ? err.message : String(err) },
        500,
      )
    }
  }

  // PUT /api/cowork/setup — persist exe/workspace (settings > env; no API restart).
  if (req.method === 'PUT' && parts.length === 3 && parts[2] === 'setup') {
    const unavailable = await requireDatabaseOrResponse()
    if (unavailable) return unavailable
    const body = (await parseJson<UpdateCoworkSetupBody>(req)) ?? {}
    const { settingsRepo } = await import('../db/repositories/settings')

    if (typeof body.exe === 'string') {
      const trimmed = body.exe.trim()
      if (trimmed) await settingsRepo.set(COWORK_SETTING_EXE, trimmed)
      else await settingsRepo.delete(COWORK_SETTING_EXE)
    }
    if (typeof body.workspace === 'string') {
      if (!isEnvSet('OPEN_COWORK_WORKSPACE') && allowDbPathSettings()) {
        const trimmed = body.workspace.trim()
        if (trimmed) await settingsRepo.set(COWORK_SETTING_WORKSPACE, trimmed)
        else await settingsRepo.delete(COWORK_SETTING_WORKSPACE)
      }
    }

    const overrides = await loadCoworkPathOverrides()
    return jsonResponse(setupPayload(getCoworkSetupInfo(overrides)))
  }

  // POST /api/cowork/tasks
  if (req.method === 'POST' && parts.length === 3 && parts[2] === 'tasks') {
    const body = (await parseJson<CreateCoworkTaskBody>(req)) ?? ({} as CreateCoworkTaskBody)
    const goal = String(body.goal ?? '').trim()
    if (!goal) return jsonResponse({ error: 'goal is required' }, 400)

    const deliverableType = body.deliverableType
    if (!deliverableType || !DELIVERABLE_TYPES.has(deliverableType)) {
      return jsonResponse(
        {
          error: 'deliverableType is required',
          allowed: [...DELIVERABLE_TYPES],
        },
        400,
      )
    }

    const overrides = await loadCoworkPathOverrides()
    const setup = getCoworkSetupInfo(overrides)
    if (!setup.exeExists) {
      return jsonResponse(
        {
          error: setup.hint,
          code: 'COWORK_EXE_MISSING',
          exe: setup.exe,
          releasesUrl: setup.releasesUrl,
          downloadUrl: setup.downloadUrl,
        },
        503,
      )
    }
    if (!setup.headlessSupported) {
      return jsonResponse(
        {
          error: setup.hint,
          code: 'COWORK_HEADLESS_UNSUPPORTED',
          exe: setup.exe,
          headlessSupported: false,
          releasesUrl: setup.releasesUrl,
          downloadUrl: setup.downloadUrl,
        },
        503,
      )
    }

    let files: PackageFileInput[] | undefined
    try {
      files = parseFilesBody(body.files)
    } catch (err) {
      return jsonResponse(
        { error: err instanceof Error ? err.message : String(err) },
        400,
      )
    }

    try {
      const started = await startCoworkTaskAsync({
        goal,
        deliverableType,
        files,
        autoApprove: body.autoApprove,
        workspace: overrides.workspace,
        exe: overrides.exe,
      })
      const payload: CreateCoworkTaskResponse = {
        taskId: started.taskId,
        status: started.status,
        sessionId: null,
      }
      return jsonResponse(payload, 202)
    } catch (err) {
      return jsonResponse(
        { error: err instanceof Error ? err.message : String(err) },
        400,
      )
    }
  }

  // GET /api/cowork/tasks
  if (req.method === 'GET' && parts.length === 3 && parts[2] === 'tasks') {
    const url = new URL(req.url)
    const limit = Math.min(
      100,
      Math.max(1, Number(url.searchParams.get('limit') ?? 50) || 50),
    )
    const overrides = await loadCoworkPathOverrides()
    const workspace = overrides.workspace ?? config.OPEN_COWORK_WORKSPACE
    const dbTasks = await tasksFromDb(limit, workspace)
    const live = listCoworkTaskRecords()
    const tasks = mergeTaskLists(live, dbTasks).slice(0, limit)
    return jsonResponse({ tasks })
  }

  // GET /api/cowork/tasks/:taskId
  if (req.method === 'GET' && parts.length === 4 && parts[2] === 'tasks') {
    const taskId = parts[3]!
    const overrides = await loadCoworkPathOverrides()
    const workspace = resolve(overrides.workspace ?? config.OPEN_COWORK_WORKSPACE)
    const live = getCoworkTaskRecord(taskId)
    const statusJson = await readStatusJson(workspace, taskId)
    const outboxFiles = await listOutboxFiles(workspace, taskId)

    let sessionId = live?.sessionId ?? null
    if (!sessionId) {
      const unavailable = await requireDatabaseOrResponse()
      if (!unavailable) {
        const found = await withDatabase(async () => {
          const sessions = await sessionsRepo.search(coworkSessionTitle(taskId), 5)
          return (
            sessions.find((s) => s.title === coworkSessionTitle(taskId)) ?? null
          )
        }, null)
        sessionId = found?.id ?? null
      }
    }

    if (!live && !statusJson && !sessionId && outboxFiles.length === 0) {
      return jsonResponse({ error: 'Task not found', taskId }, 404)
    }

    const events = sessionId
      ? await withDatabase(() => runEventsRepo.listBySession(sessionId!), [])
      : []

    let restored: CoworkTask | null = null
    if (!live && events.length > 0) {
      restored = restoreCoworkTaskFromEvents(taskId, sessionId!, events, {
        statusJson: statusJson as {
          ok?: boolean
          files?: string[]
          summary?: string
          error?: string
        } | null,
      })
    }

    // Bridge progress/questions: persisted COWORK_PROGRESS/COWORK_QUESTION
    // events (cross-process) merged with this process's in-memory entries.
    const bridge = bridgeEntriesFromEvents(events)
    const progress = [...bridge.progress]
    const seenProgress = new Set(progress.map((p) => `${p.at}|${p.message}`))
    for (const p of listCoworkTaskProgress(taskId)) {
      if (!seenProgress.has(`${p.at}|${p.message}`)) progress.push(p)
    }
    progress.sort((a, b) => a.at.localeCompare(b.at))
    const questions = [...bridge.questions]
    const seenQuestions = new Set(questions.map((q) => q.id))
    for (const q of listCoworkTaskQuestions(taskId)) {
      if (!seenQuestions.has(q.id)) questions.push(q)
    }
    questions.sort((a, b) => a.at.localeCompare(b.at))

    const files =
      live?.files?.length
        ? live.files
        : restored?.files?.length
          ? restored.files
          : Array.isArray(statusJson?.files)
            ? (statusJson!.files as string[]).map((f) => `outbox/${taskId}/${f}`)
            : outboxFiles
                .filter((n) => n !== 'status.json')
                .map((n) => `outbox/${taskId}/${n}`)

    const detail: CoworkTaskDetail = {
      taskId,
      status:
        live?.status ??
        restored?.status ??
        (statusJson?.ok === true ? 'done' : statusJson ? 'failed' : 'done'),
      goal: live?.goal ?? restored?.goal ?? null,
      deliverableType: live?.deliverableType ?? restored?.deliverableType ?? null,
      sessionId,
      inputFiles: live?.inputFiles ?? restored?.inputFiles ?? null,
      files,
      summary:
        live?.summary ??
        restored?.summary ??
        (typeof statusJson?.summary === 'string' ? statusJson.summary : null),
      error:
        live?.error ??
        restored?.error ??
        (typeof statusJson?.error === 'string' ? statusJson.error : null),
      createdAt:
        live?.createdAt ?? restored?.createdAt ?? new Date(0).toISOString(),
      finishedAt: live?.finishedAt ?? restored?.finishedAt ?? null,
      statusJson,
      outboxFiles,
      ...(progress.length > 0 ? { progress } : {}),
      ...(questions.length > 0 ? { questions } : {}),
    }
    return jsonResponse(detail)
  }

  // POST /api/cowork/tasks/:taskId/message — follow-up into a live session.
  if (
    req.method === 'POST' &&
    parts.length === 5 &&
    parts[2] === 'tasks' &&
    parts[4] === 'message'
  ) {
    const taskId = parts[3]!
    const body =
      (await parseJson<SendCoworkTaskMessageBody>(req)) ??
      ({} as SendCoworkTaskMessageBody)
    const text = String(body.text ?? '').trim()
    if (!text) return jsonResponse({ error: 'text is required' }, 400)

    const result = sendCoworkTaskMessage(taskId, text)
    const payload: SendCoworkTaskMessageResponse = {
      ok: result.ok,
      taskId,
      ...(result.ok ? {} : { error: result.error }),
    }
    if (!result.ok) {
      return jsonResponse(payload, result.code === 'not_live' ? 404 : 409)
    }
    return jsonResponse(payload)
  }

  // POST /api/cowork/tasks/:taskId/abort
  if (
    req.method === 'POST' &&
    parts.length === 5 &&
    parts[2] === 'tasks' &&
    parts[4] === 'abort'
  ) {
    const taskId = parts[3]!
    const result = await abortCoworkTask(taskId)
    const payload: AbortCoworkTaskResponse = {
      ok: result.ok,
      taskId,
      status: result.status,
      ...(result.error ? { error: result.error } : {}),
    }
    return jsonResponse(payload, result.ok ? 200 : 409)
  }

  return null
}
