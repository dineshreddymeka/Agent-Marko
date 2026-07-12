import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import type {
  KanbanTask,
  KanbanTaskComment,
  KanbanTaskStatus,
} from '@hermes/shared'
import { getDb } from '../client'
import { kanbanTaskComments, kanbanTaskLinks, kanbanTasks } from '../schema'

// ---------------------------------------------------------------------------
// DTO mappers
// ---------------------------------------------------------------------------

function taskToDto(
  row: typeof kanbanTasks.$inferSelect,
  opts?: { parentIds?: string[]; childIds?: string[]; comments?: KanbanTaskComment[] },
): KanbanTask {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    status: row.status as KanbanTaskStatus,
    priority: row.priority,
    assignee: row.assignee,
    createdBy: row.createdBy,
    blockKind: row.blockKind as KanbanTask['blockKind'],
    blockReason: row.blockReason,
    result: row.result,
    summary: row.summary,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    sessionId: row.sessionId,
    runId: row.runId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    parentIds: opts?.parentIds,
    childIds: opts?.childIds,
    comments: opts?.comments,
  }
}

function commentToDto(row: typeof kanbanTaskComments.$inferSelect): KanbanTaskComment {
  return {
    id: row.id,
    taskId: row.taskId,
    author: row.author,
    body: row.body,
    createdAt: row.createdAt.toISOString(),
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getParentIds(taskId: string): Promise<string[]> {
  const db = getDb()
  const rows = await db
    .select({ parentId: kanbanTaskLinks.parentId })
    .from(kanbanTaskLinks)
    .where(eq(kanbanTaskLinks.childId, taskId))
  return rows.map((r) => r.parentId)
}

async function getChildIds(taskId: string): Promise<string[]> {
  const db = getDb()
  const rows = await db
    .select({ childId: kanbanTaskLinks.childId })
    .from(kanbanTaskLinks)
    .where(eq(kanbanTaskLinks.parentId, taskId))
  return rows.map((r) => r.childId)
}

/**
 * Promote tasks whose all parents are done to 'ready' (matches hermes-agent
 * `recompute_ready`). Returns the number of tasks promoted.
 */
async function recomputeReady(): Promise<number> {
  const db = getDb()
  // Find tasks in 'todo' that have at least one parent link, where ALL parents are 'done'.
  // Use a subquery: tasks in todo that exist in task_links as child_id and whose
  // every parent has status = 'done'.
  const result = await db.execute(sql`
    UPDATE kanban_tasks SET status = 'ready', updated_at = now()
    WHERE status = 'todo'
      AND id IN (
        SELECT DISTINCT child_id FROM kanban_task_links
      )
      AND NOT EXISTS (
        SELECT 1 FROM kanban_task_links l
        JOIN kanban_tasks p ON p.id = l.parent_id
        WHERE l.child_id = kanban_tasks.id AND p.status <> 'done'
      )
  `)
  return Number((result as unknown as { rowCount?: number }).rowCount ?? 0)
}

// ---------------------------------------------------------------------------
// Public repository
// ---------------------------------------------------------------------------

export const kanbanRepo = {
  /** List tasks with optional filters. Promotes ready tasks before listing. */
  async listTasks(filter?: {
    status?: KanbanTaskStatus
    assignee?: string
    sessionId?: string
    includeArchived?: boolean
    limit?: number
    offset?: number
  }): Promise<{ tasks: KanbanTask[]; total: number }> {
    const db = getDb()
    await recomputeReady().catch(() => {/* best-effort */})

    const conditions = []
    if (filter?.status) {
      conditions.push(eq(kanbanTasks.status, filter.status))
    } else if (!filter?.includeArchived) {
      // Default: exclude archived
      conditions.push(sql`${kanbanTasks.status} <> 'archived'`)
    }
    if (filter?.assignee) conditions.push(eq(kanbanTasks.assignee, filter.assignee))
    if (filter?.sessionId) conditions.push(eq(kanbanTasks.sessionId, filter.sessionId))

    const limit = filter?.limit ?? 100
    const offset = filter?.offset ?? 0

    const where = conditions.length ? and(...conditions) : undefined

    const [rows, countResult] = await Promise.all([
      db
        .select()
        .from(kanbanTasks)
        .where(where)
        .orderBy(desc(kanbanTasks.priority), asc(kanbanTasks.createdAt))
        .limit(limit)
        .offset(offset),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(kanbanTasks)
        .where(where),
    ])

    const total = countResult[0]?.count ?? 0
    const tasks = rows.map((r) => taskToDto(r))
    return { tasks, total }
  },

  /** Get a single task with parents, children, and comments. */
  async getTask(id: string): Promise<KanbanTask | null> {
    const db = getDb()
    const [row] = await db.select().from(kanbanTasks).where(eq(kanbanTasks.id, id)).limit(1)
    if (!row) return null

    const [parentIds, childIds, commentRows] = await Promise.all([
      getParentIds(id),
      getChildIds(id),
      db
        .select()
        .from(kanbanTaskComments)
        .where(eq(kanbanTaskComments.taskId, id))
        .orderBy(asc(kanbanTaskComments.createdAt)),
    ])

    return taskToDto(row, {
      parentIds,
      childIds,
      comments: commentRows.map(commentToDto),
    })
  },

  async createTask(input: {
    title: string
    body?: string | null
    status?: KanbanTaskStatus
    priority?: number
    assignee?: string | null
    createdBy?: string | null
    metadata?: Record<string, unknown>
    sessionId?: string | null
    runId?: string | null
    parents?: string[]
  }): Promise<KanbanTask> {
    const db = getDb()

    const initialStatus = input.status ?? (input.parents?.length ? 'todo' : 'ready')

    const [row] = await db
      .insert(kanbanTasks)
      .values({
        title: input.title.trim(),
        body: input.body ?? null,
        status: initialStatus,
        priority: input.priority ?? 0,
        assignee: input.assignee ?? null,
        createdBy: input.createdBy ?? null,
        metadata: input.metadata ?? {},
        sessionId: input.sessionId ?? null,
        runId: input.runId ?? null,
        startedAt: initialStatus === 'running' ? new Date() : null,
      })
      .returning()

    if (!row) throw new Error('Failed to create kanban task')

    // Insert parent links
    if (input.parents?.length) {
      await db.insert(kanbanTaskLinks).values(
        input.parents.map((parentId) => ({ parentId, childId: row.id })),
      )
    }

    return taskToDto(row, {
      parentIds: input.parents ?? [],
      childIds: [],
      comments: [],
    })
  },

  async updateTask(
    id: string,
    patch: Partial<{
      title: string
      body: string | null
      status: KanbanTaskStatus
      priority: number
      assignee: string | null
      blockKind: KanbanTask['blockKind']
      blockReason: string | null
      result: string | null
      summary: string | null
      metadata: Record<string, unknown>
    }>,
  ): Promise<KanbanTask | null> {
    const db = getDb()

    const values: Record<string, unknown> = { ...patch, updatedAt: new Date() }

    // Track timestamps on status transitions
    if (patch.status === 'running' && !values.startedAt) values.startedAt = new Date()
    if (patch.status === 'done' || patch.status === 'archived') {
      if (!values.completedAt) values.completedAt = new Date()
    }

    const [row] = await db
      .update(kanbanTasks)
      .set(values as Partial<typeof kanbanTasks.$inferInsert>)
      .where(eq(kanbanTasks.id, id))
      .returning()

    if (!row) return null
    const [parentIds, childIds] = await Promise.all([getParentIds(id), getChildIds(id)])
    return taskToDto(row, { parentIds, childIds })
  },

  async deleteTask(id: string): Promise<boolean> {
    const db = getDb()
    const result = await db
      .delete(kanbanTasks)
      .where(eq(kanbanTasks.id, id))
      .returning({ id: kanbanTasks.id })
    return result.length > 0
  },

  /** Move a task to a new status (convenience wrapper). */
  async moveTask(id: string, status: KanbanTaskStatus, opts?: {
    blockKind?: KanbanTask['blockKind']
    blockReason?: string | null
    result?: string | null
    summary?: string | null
  }): Promise<KanbanTask | null> {
    return this.updateTask(id, {
      status,
      blockKind: opts?.blockKind ?? null,
      blockReason: opts?.blockReason ?? null,
      result: opts?.result,
      summary: opts?.summary,
    })
  },

  // ---------------------------------------------------------------------------
  // Parent/child links
  // ---------------------------------------------------------------------------

  async linkTasks(parentId: string, childId: string): Promise<void> {
    if (parentId === childId) throw new Error('A task cannot be its own parent')
    const db = getDb()
    await db
      .insert(kanbanTaskLinks)
      .values({ parentId, childId })
      .onConflictDoNothing()
  },

  async unlinkTasks(parentId: string, childId: string): Promise<boolean> {
    const db = getDb()
    const result = await db
      .delete(kanbanTaskLinks)
      .where(
        and(eq(kanbanTaskLinks.parentId, parentId), eq(kanbanTaskLinks.childId, childId)),
      )
      .returning({ id: kanbanTaskLinks.id })
    return result.length > 0
  },

  // ---------------------------------------------------------------------------
  // Comments
  // ---------------------------------------------------------------------------

  async addComment(taskId: string, author: string, body: string): Promise<KanbanTaskComment> {
    const db = getDb()
    const [row] = await db
      .insert(kanbanTaskComments)
      .values({ taskId, author: author.trim() || 'user', body: body.trim() })
      .returning()
    if (!row) throw new Error('Failed to add comment')
    return commentToDto(row)
  },

  async listComments(taskId: string): Promise<KanbanTaskComment[]> {
    const db = getDb()
    const rows = await db
      .select()
      .from(kanbanTaskComments)
      .where(eq(kanbanTaskComments.taskId, taskId))
      .orderBy(asc(kanbanTaskComments.createdAt))
    return rows.map(commentToDto)
  },

  async deleteComment(id: string): Promise<boolean> {
    const db = getDb()
    const result = await db
      .delete(kanbanTaskComments)
      .where(eq(kanbanTaskComments.id, id))
      .returning({ id: kanbanTaskComments.id })
    return result.length > 0
  },

  // ---------------------------------------------------------------------------
  // Status counts (for board summary)
  // ---------------------------------------------------------------------------

  async getStatusCounts(): Promise<Record<KanbanTaskStatus, number>> {
    const db = getDb()
    const rows = await db.execute(sql`
      SELECT status, count(*)::int AS cnt
      FROM kanban_tasks
      GROUP BY status
    `)
    const out: Record<string, number> = {
      triage: 0, todo: 0, ready: 0, running: 0, blocked: 0, done: 0, archived: 0,
    }
    for (const row of rows as Array<{ status: string; cnt: number }>) {
      if (row.status in out) out[row.status] = row.cnt
    }
    return out as Record<KanbanTaskStatus, number>
  },

  /** Bulk-link a session's tasks when a session starts an agent run. */
  async linkSessionTasks(sessionId: string, runId: string): Promise<void> {
    const db = getDb()
    await db
      .update(kanbanTasks)
      .set({ runId, updatedAt: new Date() })
      .where(
        and(
          eq(kanbanTasks.sessionId, sessionId),
          inArray(kanbanTasks.status, ['ready', 'running']),
        ),
      )
  },
}
