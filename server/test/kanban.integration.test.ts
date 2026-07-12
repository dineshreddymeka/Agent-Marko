/**
 * Kanban REST API — full field round-trip (integration).
 * Requires HERMES_INTEGRATION_TEST=1 and local Postgres 17 on :5433.
 */
import { afterEach, beforeAll, describe, expect, test } from 'bun:test'
import type {
  KanbanListResponse,
  KanbanStatusCounts,
  KanbanTask,
  KanbanTaskComment,
} from '@hermes/shared'
import { sessionsRepo } from '../src/db/repositories/sessions'
import { handleKanban } from '../src/rest/kanban'
import { isIntegrationEnabled, prepareIntegrationDb, truncateAppTables } from './helpers/db'

const enabled = await isIntegrationEnabled()

const BASE = 'http://localhost/api/kanban'

async function kanban(
  path: string,
  init?: RequestInit,
): Promise<{ status: number; body: unknown }> {
  const routePath = `/api/kanban${path.split('?')[0]}`
  const res = await handleKanban(
    new Request(`${BASE}${path}`, {
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
      ...init,
    }),
    routePath,
  )
  expect(res).not.toBeNull()
  const body = res!.status === 204 ? null : await res!.json()
  return { status: res!.status, body }
}

function expectTaskFields(task: KanbanTask, expected: Partial<KanbanTask>) {
  if (expected.id != null) expect(task.id).toBe(expected.id)
  if (expected.title != null) expect(task.title).toBe(expected.title)
  if ('body' in expected) expect(task.body).toBe(expected.body ?? null)
  if (expected.status != null) expect(task.status).toBe(expected.status)
  if (expected.priority != null) expect(task.priority).toBe(expected.priority)
  if ('assignee' in expected) expect(task.assignee).toBe(expected.assignee ?? null)
  if ('createdBy' in expected) expect(task.createdBy).toBe(expected.createdBy ?? null)
  if ('blockKind' in expected) expect(task.blockKind).toBe(expected.blockKind ?? null)
  if ('blockReason' in expected) expect(task.blockReason).toBe(expected.blockReason ?? null)
  if ('result' in expected) expect(task.result).toBe(expected.result ?? null)
  if ('summary' in expected) expect(task.summary).toBe(expected.summary ?? null)
  if (expected.metadata != null) expect(task.metadata).toEqual(expected.metadata)
  if ('sessionId' in expected) expect(task.sessionId).toBe(expected.sessionId ?? null)
  if ('runId' in expected) expect(task.runId).toBe(expected.runId ?? null)
  if (expected.createdAt != null) expect(task.createdAt).toBe(expected.createdAt)
  if (expected.updatedAt != null) expect(task.updatedAt).toBe(expected.updatedAt)
  if ('startedAt' in expected) expect(task.startedAt).toBe(expected.startedAt ?? null)
  if ('completedAt' in expected) expect(task.completedAt).toBe(expected.completedAt ?? null)
  if (expected.parentIds != null) expect(task.parentIds).toEqual(expected.parentIds)
  if (expected.childIds != null) expect(task.childIds).toEqual(expected.childIds)
}

function expectCommentFields(comment: KanbanTaskComment, expected: Partial<KanbanTaskComment>) {
  if (expected.id != null) expect(comment.id).toBe(expected.id)
  if (expected.taskId != null) expect(comment.taskId).toBe(expected.taskId)
  if (expected.author != null) expect(comment.author).toBe(expected.author)
  if (expected.body != null) expect(comment.body).toBe(expected.body)
  if (expected.createdAt != null) expect(comment.createdAt).toBe(expected.createdAt)
}

describe.skipIf(!enabled)('Kanban REST API (integration)', () => {
  beforeAll(async () => {
    await prepareIntegrationDb()
  })

  afterEach(async () => {
    await truncateAppTables()
  }, 15_000)

  test(
    'full lifecycle: create, read, patch, move, comments, links, filters, counts, sync, delete',
    async () => {
    const session = await sessionsRepo.create({ title: 'Kanban integration session' })
    const runId = crypto.randomUUID()
    const metadata = { source: 'integration', tags: ['api', 'kanban'], priority_label: 'high' }

    // Parent task for dependency links
    const parentRes = await kanban('/tasks', {
      method: 'POST',
      body: JSON.stringify({
        title: 'Parent task',
        status: 'done',
        createdBy: 'test-suite',
      }),
    })
    expect(parentRes.status).toBe(201)
    const parent = parentRes.body as KanbanTask

    // POST create with all supported create fields
    const createRes = await kanban('/tasks', {
      method: 'POST',
      body: JSON.stringify({
        title: 'Integration kanban task',
        body: 'Full field coverage test body',
        status: 'triage',
        priority: 7,
        assignee: 'agent-alpha',
        createdBy: 'integration-user',
        metadata,
        sessionId: session.id,
        runId,
        parents: [parent.id],
      }),
    })
    expect(createRes.status).toBe(201)
    const created = createRes.body as KanbanTask

    expectTaskFields(created, {
      title: 'Integration kanban task',
      body: 'Full field coverage test body',
      status: 'triage',
      priority: 7,
      assignee: 'agent-alpha',
      createdBy: 'integration-user',
      metadata,
      sessionId: session.id,
      runId,
      parentIds: [parent.id],
      childIds: [],
      blockKind: null,
      blockReason: null,
      result: null,
      summary: null,
      startedAt: null,
      completedAt: null,
    })
    expect(created.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    )
    expect(created.createdAt).toBeTruthy()
    expect(created.updatedAt).toBeTruthy()
    expect(created.comments).toEqual([])

    // GET single task — every scalar field round-trips
    const getRes = await kanban(`/tasks/${created.id}`)
    expect(getRes.status).toBe(200)
    const fetched = getRes.body as KanbanTask
    expectTaskFields(fetched, {
      id: created.id,
      title: created.title,
      body: created.body,
      status: created.status,
      priority: created.priority,
      assignee: created.assignee,
      createdBy: created.createdBy,
      metadata: created.metadata,
      sessionId: created.sessionId,
      runId: created.runId,
      createdAt: created.createdAt,
      updatedAt: created.updatedAt,
      blockKind: null,
      blockReason: null,
      result: null,
      summary: null,
      startedAt: null,
      completedAt: null,
      parentIds: [parent.id],
      childIds: [],
    })
    expect(fetched.comments).toEqual([])

    // PATCH update — change editable fields including block/result/summary
    const patchMetadata = { ...metadata, patched: true, revision: 2 }
    const patchRes = await kanban(`/tasks/${created.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        title: 'Updated kanban task',
        body: 'Patched body text',
        priority: 3,
        assignee: 'agent-beta',
        blockKind: 'needs_input',
        blockReason: 'Awaiting user confirmation',
        result: null,
        summary: 'Work in progress',
        metadata: patchMetadata,
      }),
    })
    expect(patchRes.status).toBe(200)
    const patched = patchRes.body as KanbanTask
    expectTaskFields(patched, {
      title: 'Updated kanban task',
      body: 'Patched body text',
      priority: 3,
      assignee: 'agent-beta',
      blockKind: 'needs_input',
      blockReason: 'Awaiting user confirmation',
      summary: 'Work in progress',
      metadata: patchMetadata,
    })
    expect(patched.updatedAt >= created.updatedAt).toBe(true)

    const getAfterPatch = await kanban(`/tasks/${created.id}`)
    expectTaskFields(getAfterPatch.body as KanbanTask, {
      title: 'Updated kanban task',
      body: 'Patched body text',
      priority: 3,
      assignee: 'agent-beta',
      blockKind: 'needs_input',
      blockReason: 'Awaiting user confirmation',
      summary: 'Work in progress',
      metadata: patchMetadata,
    })

    // POST move — running sets startedAt
    const moveRunning = await kanban(`/tasks/${created.id}/move`, {
      method: 'POST',
      body: JSON.stringify({ status: 'running' }),
    })
    expect(moveRunning.status).toBe(200)
    const running = moveRunning.body as KanbanTask
    expect(running.status).toBe('running')
    expect(running.startedAt).toBeTruthy()

    // POST move — blocked with blockKind/blockReason
    const moveBlocked = await kanban(`/tasks/${created.id}/move`, {
      method: 'POST',
      body: JSON.stringify({
        status: 'blocked',
        blockKind: 'dependency',
        blockReason: 'Waiting on parent completion',
      }),
    })
    expect(moveBlocked.status).toBe(200)
    const blocked = moveBlocked.body as KanbanTask
    expectTaskFields(blocked, {
      status: 'blocked',
      blockKind: 'dependency',
      blockReason: 'Waiting on parent completion',
    })

    // POST move — done with result/summary sets completedAt
    const moveDone = await kanban(`/tasks/${created.id}/move`, {
      method: 'POST',
      body: JSON.stringify({
        status: 'done',
        blockKind: null,
        blockReason: null,
        result: 'Task completed successfully',
        summary: 'All acceptance criteria met',
      }),
    })
    expect(moveDone.status).toBe(200)
    const done = moveDone.body as KanbanTask
    expectTaskFields(done, {
      status: 'done',
      blockKind: null,
      blockReason: null,
      result: 'Task completed successfully',
      summary: 'All acceptance criteria met',
    })
    expect(done.completedAt).toBeTruthy()

    // Child task + POST link
    const childRes = await kanban('/tasks', {
      method: 'POST',
      body: JSON.stringify({ title: 'Child task', status: 'todo' }),
    })
    expect(childRes.status).toBe(201)
    const child = childRes.body as KanbanTask

    const linkRes = await kanban(`/tasks/${created.id}/link`, {
      method: 'POST',
      body: JSON.stringify({ childId: child.id }),
    })
    expect(linkRes.status).toBe(200)
    expect(linkRes.body).toMatchObject({ ok: true, parentId: created.id, childId: child.id })

    const parentView = await kanban(`/tasks/${created.id}`)
    const childView = await kanban(`/tasks/${child.id}`)
    expect((parentView.body as KanbanTask).childIds).toEqual([child.id])
    expect((childView.body as KanbanTask).parentIds).toEqual([created.id])

    // POST comment + GET comments + GET task with comments
    const commentRes = await kanban(`/tasks/${created.id}/comments`, {
      method: 'POST',
      body: JSON.stringify({ author: 'reviewer', body: 'Looks good to merge' }),
    })
    expect(commentRes.status).toBe(201)
    const comment = commentRes.body as KanbanTaskComment
    expectCommentFields(comment, {
      taskId: created.id,
      author: 'reviewer',
      body: 'Looks good to merge',
    })
    expect(comment.id).toBeTruthy()
    expect(comment.createdAt).toBeTruthy()

    const listCommentsRes = await kanban(`/tasks/${created.id}/comments`)
    expect(listCommentsRes.status).toBe(200)
    const comments = listCommentsRes.body as KanbanTaskComment[]
    expect(comments).toHaveLength(1)
    expectCommentFields(comments[0]!, comment)

    const taskWithComments = await kanban(`/tasks/${created.id}`)
    expect((taskWithComments.body as KanbanTask).comments).toHaveLength(1)
    expectCommentFields((taskWithComments.body as KanbanTask).comments![0]!, comment)

    // GET list with filters
    const byStatus = await kanban('/tasks?status=done')
    expect(byStatus.status).toBe(200)
    const statusList = byStatus.body as KanbanListResponse
    expect(statusList.tasks.map((t) => t.id)).toContain(created.id)
    expect(statusList.total).toBeGreaterThanOrEqual(1)

    const byAssignee = await kanban('/tasks?assignee=agent-beta')
    expect(byAssignee.status).toBe(200)
    expect((byAssignee.body as KanbanListResponse).tasks.map((t) => t.id)).toContain(created.id)

    const bySession = await kanban(`/tasks?sessionId=${session.id}`)
    expect(bySession.status).toBe(200)
    expect((bySession.body as KanbanListResponse).tasks.map((t) => t.id)).toContain(created.id)

    // GET status-counts (child may be promoted todo→ready by prior listTasks recomputeReady)
    const countsRes = await kanban('/status-counts')
    expect(countsRes.status).toBe(200)
    const counts = countsRes.body as KanbanStatusCounts
    expect(counts.done).toBeGreaterThanOrEqual(2)
    expect(counts.ready + counts.todo).toBeGreaterThanOrEqual(1)

    // POST sync-session — links runId on ready/running tasks for session
    const readyTaskRes = await kanban('/tasks', {
      method: 'POST',
      body: JSON.stringify({
        title: 'Ready for run',
        status: 'ready',
        sessionId: session.id,
      }),
    })
    const runningTaskRes = await kanban('/tasks', {
      method: 'POST',
      body: JSON.stringify({
        title: 'Running with session',
        status: 'running',
        sessionId: session.id,
      }),
    })
    const doneTaskRes = await kanban('/tasks', {
      method: 'POST',
      body: JSON.stringify({
        title: 'Already done',
        status: 'done',
        sessionId: session.id,
      }),
    })
    const syncRunId = crypto.randomUUID()
    const syncRes = await kanban('/sync-session', {
      method: 'POST',
      body: JSON.stringify({ sessionId: session.id, runId: syncRunId }),
    })
    expect(syncRes.status).toBe(200)
    expect(syncRes.body).toEqual({ ok: true })

    const readyAfterSync = await kanban(`/tasks/${(readyTaskRes.body as KanbanTask).id}`)
    const runningAfterSync = await kanban(`/tasks/${(runningTaskRes.body as KanbanTask).id}`)
    const doneAfterSync = await kanban(`/tasks/${(doneTaskRes.body as KanbanTask).id}`)
    expect((readyAfterSync.body as KanbanTask).runId).toBe(syncRunId)
    expect((runningAfterSync.body as KanbanTask).runId).toBe(syncRunId)
    expect((doneAfterSync.body as KanbanTask).runId).toBeNull()

    // DELETE link
    const unlinkRes = await kanban(`/tasks/${created.id}/link`, {
      method: 'DELETE',
      body: JSON.stringify({ childId: child.id }),
    })
    expect(unlinkRes.status).toBe(200)
    expect(unlinkRes.body).toEqual({ unlinked: true })
    const parentAfterUnlink = await kanban(`/tasks/${created.id}`)
    expect((parentAfterUnlink.body as KanbanTask).childIds).toEqual([])

    // DELETE comment
    const delCommentRes = await kanban(`/comments/${comment.id}`, { method: 'DELETE' })
    expect(delCommentRes.status).toBe(200)
    expect(delCommentRes.body).toEqual({ deleted: true })
    const commentsAfterDelete = await kanban(`/tasks/${created.id}/comments`)
    expect(commentsAfterDelete.body).toEqual([])

    // DELETE task
    const delTaskRes = await kanban(`/tasks/${created.id}`, { method: 'DELETE' })
    expect(delTaskRes.status).toBe(200)
    expect(delTaskRes.body).toEqual({ deleted: true })
    const gone = await kanban(`/tasks/${created.id}`)
    expect(gone.status).toBe(404)

    // Cleanup remaining tasks
    for (const id of [parent.id, child.id, (readyTaskRes.body as KanbanTask).id, (runningTaskRes.body as KanbanTask).id, (doneTaskRes.body as KanbanTask).id]) {
      await kanban(`/tasks/${id}`, { method: 'DELETE' })
    }
  },
    30_000,
  )
})
