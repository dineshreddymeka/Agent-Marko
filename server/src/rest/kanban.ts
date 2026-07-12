/**
 * Kanban REST handler — ported from hermes-agent kanban domain model.
 *
 * Routes:
 *   GET    /api/kanban/tasks               list tasks (filter: status, assignee, sessionId, includeArchived, limit, offset)
 *   POST   /api/kanban/tasks               create task
 *   GET    /api/kanban/tasks/:id           get task (with parents, children, comments)
 *   PATCH  /api/kanban/tasks/:id           update task fields
 *   DELETE /api/kanban/tasks/:id           delete task
 *   POST   /api/kanban/tasks/:id/move      move task to a new status
 *   GET    /api/kanban/tasks/:id/comments  list comments
 *   POST   /api/kanban/tasks/:id/comments  add comment
 *   DELETE /api/kanban/comments/:id        delete comment
 *   POST   /api/kanban/tasks/:id/link      link parent → child (body: { childId })
 *   DELETE /api/kanban/tasks/:id/link      unlink (body: { childId })
 *   GET    /api/kanban/status-counts       aggregate counts per status
 */
import type { KanbanTaskStatus } from '@hermes/shared'
import { jsonResponse, parseJson } from './helpers'
import { requireDatabaseOrResponse, withDatabase } from './db-guard'

const VALID_STATUSES = new Set<KanbanTaskStatus>([
  'triage', 'todo', 'ready', 'running', 'blocked', 'done', 'archived',
])

const VALID_BLOCK_KINDS = new Set(['dependency', 'needs_input', 'capability', 'transient'])

function validateStatus(value: unknown): KanbanTaskStatus | null {
  if (typeof value === 'string' && VALID_STATUSES.has(value as KanbanTaskStatus)) {
    return value as KanbanTaskStatus
  }
  return null
}

export async function handleKanban(req: Request, path: string): Promise<Response | null> {
  const { kanbanRepo } = await import('../db/repositories/kanban')
  const parts = path.replace(/^\/api\/kanban\/?/, '').split('/').filter(Boolean)

  // GET /api/kanban/status-counts
  if (req.method === 'GET' && parts[0] === 'status-counts' && parts.length === 1) {
    return jsonResponse(
      await withDatabase(() => kanbanRepo.getStatusCounts(), {
        triage: 0, todo: 0, ready: 0, running: 0, blocked: 0, done: 0, archived: 0,
      }),
    )
  }

  // POST /api/kanban/sync-session — link all ready/running tasks for a session to a run
  if (req.method === 'POST' && parts[0] === 'sync-session' && parts.length === 1) {
    const unavailable = await requireDatabaseOrResponse()
    if (unavailable) return unavailable
    const body = (await parseJson(req)) ?? {}
    const sessionId = body.sessionId ? String(body.sessionId) : null
    const runId = body.runId ? String(body.runId) : null
    if (!sessionId || !runId) {
      return jsonResponse({ error: 'sessionId and runId are required' }, 400)
    }
    await kanbanRepo.linkSessionTasks(sessionId, runId)
    return jsonResponse({ ok: true })
  }

  // DELETE /api/kanban/comments/:id
  if (req.method === 'DELETE' && parts[0] === 'comments' && parts.length === 2) {
    const unavailable = await requireDatabaseOrResponse()
    if (unavailable) return unavailable
    const deleted = await kanbanRepo.deleteComment(parts[1]!)
    return jsonResponse({ deleted })
  }

  // /api/kanban/tasks (collection)
  if (parts[0] === 'tasks' && parts.length === 1) {
    if (req.method === 'GET') {
      const url = new URL(req.url)
      const status = url.searchParams.get('status')
      const assignee = url.searchParams.get('assignee') ?? undefined
      const sessionId = url.searchParams.get('sessionId') ?? undefined
      const includeArchived = url.searchParams.get('includeArchived') === 'true'
      const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '100', 10), 200)
      const offset = Math.max(parseInt(url.searchParams.get('offset') ?? '0', 10), 0)

      const validStatus = status ? validateStatus(status) : undefined
      if (status && !validStatus) {
        return jsonResponse({ error: `Invalid status: ${status}` }, 400)
      }

      return jsonResponse(
        await withDatabase(
          () => kanbanRepo.listTasks({ status: validStatus ?? undefined, assignee, sessionId, includeArchived, limit, offset }),
          { tasks: [], total: 0 },
        ),
      )
    }

    if (req.method === 'POST') {
      const unavailable = await requireDatabaseOrResponse()
      if (unavailable) return unavailable
      const body = await parseJson(req)
      if (!body?.title) return jsonResponse({ error: 'title is required' }, 400)

      const statusRaw = body.status ? validateStatus(body.status) : undefined
      if (body.status && !statusRaw) {
        return jsonResponse({ error: `Invalid status: ${body.status}` }, 400)
      }
      const status: KanbanTaskStatus | undefined = statusRaw ?? undefined
      const parents = Array.isArray(body.parents) ? body.parents.map(String) : undefined

      const task = await kanbanRepo.createTask({
        title: String(body.title),
        body: body.body != null ? String(body.body) : null,
        status,
        priority: body.priority != null ? Number(body.priority) : 0,
        assignee: body.assignee != null ? String(body.assignee) : null,
        createdBy: body.createdBy != null ? String(body.createdBy) : null,
        metadata: typeof body.metadata === 'object' && body.metadata !== null
          ? (body.metadata as Record<string, unknown>)
          : {},
        sessionId: body.sessionId != null ? String(body.sessionId) : null,
        runId: body.runId != null ? String(body.runId) : null,
        parents,
      })
      return jsonResponse(task, 201)
    }
  }

  // /api/kanban/tasks/:id
  if (parts[0] === 'tasks' && parts.length >= 2) {
    const taskId = parts[1]!

    // GET /api/kanban/tasks/:id
    if (req.method === 'GET' && parts.length === 2) {
      const task = await withDatabase(() => kanbanRepo.getTask(taskId), null)
      if (!task) return jsonResponse({ error: 'Not found' }, 404)
      return jsonResponse(task)
    }

    // PATCH /api/kanban/tasks/:id
    if (req.method === 'PATCH' && parts.length === 2) {
      const unavailable = await requireDatabaseOrResponse()
      if (unavailable) return unavailable
      const body = (await parseJson(req)) ?? {}

      const patch: Parameters<typeof kanbanRepo.updateTask>[1] = {}
      if ('title' in body) patch.title = String(body.title)
      if ('body' in body) patch.body = body.body != null ? String(body.body) : null
      if ('status' in body) {
        const s = validateStatus(body.status)
        if (!s) return jsonResponse({ error: `Invalid status: ${body.status}` }, 400)
        patch.status = s
      }
      if ('priority' in body) patch.priority = Number(body.priority)
      if ('assignee' in body) patch.assignee = body.assignee != null ? String(body.assignee) : null
      if ('blockKind' in body) {
        const bk = body.blockKind
        if (bk !== null && !VALID_BLOCK_KINDS.has(String(bk))) {
          return jsonResponse({ error: `Invalid blockKind: ${bk}` }, 400)
        }
        patch.blockKind = bk as KanbanTask['blockKind']
      }
      if ('blockReason' in body) patch.blockReason = body.blockReason != null ? String(body.blockReason) : null
      if ('result' in body) patch.result = body.result != null ? String(body.result) : null
      if ('summary' in body) patch.summary = body.summary != null ? String(body.summary) : null
      if ('metadata' in body && typeof body.metadata === 'object' && body.metadata !== null) {
        patch.metadata = body.metadata as Record<string, unknown>
      }

      const task = await kanbanRepo.updateTask(taskId, patch)
      if (!task) return jsonResponse({ error: 'Not found' }, 404)
      return jsonResponse(task)
    }

    // DELETE /api/kanban/tasks/:id
    if (req.method === 'DELETE' && parts.length === 2) {
      const unavailable = await requireDatabaseOrResponse()
      if (unavailable) return unavailable
      const deleted = await kanbanRepo.deleteTask(taskId)
      return jsonResponse({ deleted })
    }

    // POST /api/kanban/tasks/:id/move
    if (req.method === 'POST' && parts[2] === 'move') {
      const unavailable = await requireDatabaseOrResponse()
      if (unavailable) return unavailable
      const body = (await parseJson(req)) ?? {}
      const status = validateStatus(body.status)
      if (!status) return jsonResponse({ error: 'valid status required' }, 400)

      const blockKind = body.blockKind != null && VALID_BLOCK_KINDS.has(String(body.blockKind))
        ? (body.blockKind as KanbanTask['blockKind'])
        : null

      const task = await kanbanRepo.moveTask(taskId, status, {
        blockKind,
        blockReason: body.blockReason != null ? String(body.blockReason) : null,
        result: body.result != null ? String(body.result) : undefined,
        summary: body.summary != null ? String(body.summary) : undefined,
      })
      if (!task) return jsonResponse({ error: 'Not found' }, 404)
      return jsonResponse(task)
    }

    // GET /api/kanban/tasks/:id/comments
    if (req.method === 'GET' && parts[2] === 'comments') {
      const comments = await withDatabase(() => kanbanRepo.listComments(taskId), [])
      return jsonResponse(comments)
    }

    // POST /api/kanban/tasks/:id/comments
    if (req.method === 'POST' && parts[2] === 'comments') {
      const unavailable = await requireDatabaseOrResponse()
      if (unavailable) return unavailable
      const body = await parseJson(req)
      if (!body?.body) return jsonResponse({ error: 'body is required' }, 400)
      const comment = await kanbanRepo.addComment(
        taskId,
        String(body.author ?? 'user'),
        String(body.body),
      )
      return jsonResponse(comment, 201)
    }

    // POST /api/kanban/tasks/:id/link
    if (req.method === 'POST' && parts[2] === 'link') {
      const unavailable = await requireDatabaseOrResponse()
      if (unavailable) return unavailable
      const body = await parseJson(req)
      if (!body?.childId) return jsonResponse({ error: 'childId is required' }, 400)
      try {
        await kanbanRepo.linkTasks(taskId, String(body.childId))
        return jsonResponse({ ok: true, parentId: taskId, childId: String(body.childId) })
      } catch (err) {
        return jsonResponse({ error: String(err) }, 400)
      }
    }

    // DELETE /api/kanban/tasks/:id/link
    if (req.method === 'DELETE' && parts[2] === 'link') {
      const unavailable = await requireDatabaseOrResponse()
      if (unavailable) return unavailable
      const body = (await parseJson(req)) ?? {}
      if (!body.childId) return jsonResponse({ error: 'childId is required' }, 400)
      const unlinked = await kanbanRepo.unlinkTasks(taskId, String(body.childId))
      return jsonResponse({ unlinked })
    }
  }

  return null
}

// Helper to satisfy TypeScript import of KanbanTask type used inside handler
type KanbanTask = import('@hermes/shared').KanbanTask
