import { randomUUID } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { config } from '../config'
import { indexerRepo, type IndexJob, type IndexSourceType } from '../db/repositories/indexer'
import { messagesRepo } from '../db/repositories/messages'
import { memoryRepo } from '../db/repositories/memory'
import { skillsRepo } from '../db/repositories/skills'
import { sessionsRepo } from '../db/repositories/sessions'
import { cronRepo } from '../db/repositories/cron'
import { runEventsRepo } from '../db/repositories/run_events'
import { restoreCoworkTaskFromEvents, coworkSessionTitle } from '../cowork/persist'
import { resolveCoworkWorkspace } from '../cowork/client'
import { toWorkspaceRelative } from '../fs/path-jail'
import { logger } from '../log'
import { chunkText } from './chunker'
import { hashText } from './hashing'
import { isIgnoredPath, isTextFile, normalizeIndexPath } from './ignore'
import { embedBatchLocal, isLocalEmbeddingEndpoint } from './local-embeddings'

export { isIgnoredPath } from './ignore'
export { scanWorkspace } from './scanner'

const log = logger.child({ component: 'indexer' })

function maxFileBytes(): number {
  return config.INDEXER_MAX_FILE_BYTES
}

function workspaceRoot(): string {
  return resolve(config.WORKSPACE_ROOT)
}

function normalizePath(path: string): string {
  return normalizeIndexPath(path)
}

function workspaceRelative(path: string): string {
  return normalizePath(toWorkspaceRelative(workspaceRoot(), path))
}

function metadataWithJob(job?: Partial<IndexJob>): Record<string, unknown> {
  return {
    indexedBy: 'jarvis-fast-indexer',
    actionId: job?.actionId ?? undefined,
    sessionId: job?.sessionId ?? undefined,
    runId: job?.runId ?? undefined,
    ...job?.metadata,
  }
}

function isSameMeta(
  existing: {
    sessionId: string | null
    runId: string | null
    actionId: string | null
    tags: string[]
  },
  next: {
    sessionId?: string | null
    runId?: string | null
    actionId?: string | null
    tags?: string[]
  },
): boolean {
  const tagsEqual =
    JSON.stringify([...(existing.tags ?? [])].sort()) ===
    JSON.stringify([...(next.tags ?? [])].sort())
  return (
    (existing.sessionId ?? null) === (next.sessionId ?? null) &&
    (existing.runId ?? null) === (next.runId ?? null) &&
    (existing.actionId ?? null) === (next.actionId ?? null) &&
    tagsEqual
  )
}

async function upsertTextDocument(input: {
  sourceType: IndexSourceType
  sourceId: string
  text: string
  title?: string | null
  path?: string | null
  mimeType?: string | null
  sizeBytes?: number | null
  mtime?: Date | null
  sessionId?: string | null
  runId?: string | null
  userId?: string | null
  actionId?: string | null
  tags?: string[]
  metadata?: Record<string, unknown>
}): Promise<void> {
  const contentHash = hashText(input.text)
  const existing = await indexerRepo.getDocument(input.sourceType, input.sourceId)
  const chunksReady =
    existing?.contentHash === contentHash &&
    !existing.deletedAt &&
    existing.chunkCount > 0

  if (chunksReady) {
    if (!isSameMeta(existing, input)) {
      await indexerRepo.patchDocumentMeta(existing.id, {
        sessionId: input.sessionId,
        runId: input.runId,
        userId: input.userId,
        actionId: input.actionId,
        tags: input.tags,
        metadata: input.metadata,
        title: input.title,
        path: input.path,
        mtime: input.mtime,
      })
    }
    return
  }

  const textChunks = chunkText(input.text, {
    maxChars: config.INDEXER_CHUNK_CHARS,
    overlapChars: config.INDEXER_CHUNK_OVERLAP,
  })
  let embeddings: Array<number[] | null> = textChunks.map(() => null)
  let embeddingPending = false
  try {
    if (textChunks.length) {
      embeddings = await embedBatchLocal(textChunks.map((chunk) => chunk.content))
    }
  } catch (err) {
    embeddingPending = true
    log.warn('Embedding failed; indexing FTS-only chunks', {
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      error: String(err),
    })
  }

  const documentId = await indexerRepo.upsertDocumentWithChunks(
    {
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      path: input.path,
      title: input.title,
      contentHash,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes ?? input.text.length,
      mtime: input.mtime,
      sessionId: input.sessionId,
      runId: input.runId,
      userId: input.userId,
      actionId: input.actionId,
      tags: input.tags,
      metadata: {
        ...input.metadata,
        embeddingPending,
      },
    },
    textChunks.map((chunk, i) => ({
      ...chunk,
      embedding: embeddings[i] ?? null,
      metadata: input.metadata,
    })),
  )

  if (input.actionId) {
    await indexerRepo.linkAction({
      actionId: input.actionId,
      documentId,
      targetType: input.sourceType,
      targetId: input.sourceId,
      relation: 'indexed',
    })
  }
}

export async function queueWorkspaceFile(
  path: string,
  opts?: { sessionId?: string; runId?: string; userId?: string; actionId?: string; priority?: number },
): Promise<void> {
  const rel = workspaceRelative(path)
  const actionId = opts?.actionId ?? randomUUID()
  await indexerRepo.recordAction({
    actionId,
    sessionId: opts?.sessionId,
    runId: opts?.runId,
    userId: opts?.userId,
    sourceType: 'workspace_file',
    sourceId: rel,
    actionType: 'workspace_file_changed',
    summary: `Workspace file changed: ${rel}`,
  })
  await indexerRepo.enqueueJob({
    sourceType: 'workspace_file',
    sourceId: rel,
    operation: 'upsert',
    actionId,
    sessionId: opts?.sessionId,
    runId: opts?.runId,
    userId: opts?.userId,
    priority: opts?.priority ?? 0,
  })
}

export async function queueWorkspaceDelete(
  path: string,
  opts?: { sessionId?: string; runId?: string; userId?: string; actionId?: string; priority?: number },
): Promise<void> {
  const rel = workspaceRelative(path)
  const actionId = opts?.actionId ?? randomUUID()
  await indexerRepo.recordAction({
    actionId,
    sessionId: opts?.sessionId,
    runId: opts?.runId,
    userId: opts?.userId,
    sourceType: 'workspace_file',
    sourceId: rel,
    actionType: 'workspace_file_deleted',
    summary: `Workspace file deleted: ${rel}`,
  })
  await indexerRepo.enqueueJob({
    sourceType: 'workspace_file',
    sourceId: rel,
    operation: 'delete',
    actionId,
    sessionId: opts?.sessionId,
    runId: opts?.runId,
    userId: opts?.userId,
    priority: opts?.priority ?? 0,
  })
}

export async function queueRuntimeRecord(
  sourceType: Exclude<IndexSourceType, 'workspace_file'>,
  sourceId: string,
  opts?: { sessionId?: string | null; runId?: string | null; userId?: string | null; priority?: number },
): Promise<void> {
  const actionId = sourceId.match(/^[0-9a-f-]{36}$/i) ? sourceId : randomUUID()
  await indexerRepo.recordAction({
    actionId,
    sessionId: opts?.sessionId ?? null,
    runId: opts?.runId ?? null,
    userId: opts?.userId ?? null,
    sourceType,
    sourceId,
    actionType: `${sourceType}_changed`,
    summary: `${sourceType} changed`,
  })
  await indexerRepo.enqueueJob({
    sourceType,
    sourceId,
    operation: 'upsert',
    actionId,
    sessionId: opts?.sessionId ?? null,
    runId: opts?.runId ?? null,
    userId: opts?.userId ?? null,
    priority: opts?.priority ?? 0,
  })
}

export async function queueRuntimeDelete(
  sourceType: Exclude<IndexSourceType, 'workspace_file'>,
  sourceId: string,
  opts?: {
    sessionId?: string | null
    runId?: string | null
    userId?: string | null
    parentActionId?: string | null
  },
): Promise<void> {
  const actionId = randomUUID()
  await indexerRepo.recordAction({
    actionId,
    sessionId: opts?.sessionId ?? null,
    runId: opts?.runId ?? null,
    userId: opts?.userId ?? null,
    parentActionId: opts?.parentActionId ?? null,
    sourceType,
    sourceId,
    actionType: `${sourceType}_deleted`,
    summary: `${sourceType} deleted`,
  })
  await indexerRepo.enqueueJob({
    sourceType,
    sourceId,
    operation: 'delete',
    actionId,
    sessionId: opts?.sessionId ?? null,
    runId: opts?.runId ?? null,
    userId: opts?.userId ?? null,
    priority: 5,
  })
}

function isNotFound(err: unknown): boolean {
  return Boolean(err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === 'ENOENT')
}

export async function indexWorkspaceFile(job: IndexJob): Promise<void> {
  let rel: string
  try {
    rel = workspaceRelative(job.sourceId)
  } catch {
    await indexerRepo.markDeleted('workspace_file', normalizePath(job.sourceId))
    return
  }
  if (isIgnoredPath(rel) || !isTextFile(rel)) {
    await indexerRepo.markDeleted('workspace_file', rel)
    return
  }

  const full = resolve(workspaceRoot(), rel)
  let info: Awaited<ReturnType<typeof stat>>
  try {
    info = await stat(full)
  } catch (err) {
    if (isNotFound(err)) {
      await indexerRepo.markDeleted('workspace_file', rel)
      return
    }
    throw err
  }
  if (!info.isFile() || info.size > maxFileBytes()) {
    await indexerRepo.markDeleted('workspace_file', rel)
    return
  }

  let buf: Buffer
  try {
    buf = await readFile(full)
  } catch (err) {
    if (isNotFound(err)) {
      await indexerRepo.markDeleted('workspace_file', rel)
      return
    }
    throw err
  }
  if (buf.includes(0)) {
    await indexerRepo.markDeleted('workspace_file', rel)
    return
  }
  const text = buf.toString('utf8')
  await upsertTextDocument({
    sourceType: 'workspace_file',
    sourceId: rel,
    path: rel,
    title: basename(rel),
    text,
    mimeType: 'text/plain',
    sizeBytes: info.size,
    mtime: info.mtime,
    sessionId: job.sessionId,
    runId: job.runId,
    userId: job.userId,
    actionId: job.actionId,
    tags: ['workspace'],
    metadata: metadataWithJob(job),
  })
}

export async function indexRuntimeRecord(job: IndexJob): Promise<void> {
  if (job.sourceType === 'message') {
    const message = await messagesRepo.getById(job.sourceId)
    if (!message) return indexerRepo.markDeleted('message', job.sourceId)
    await upsertTextDocument({
      sourceType: 'message',
      sourceId: message.id,
      title: `${message.role} message`,
      text: message.content,
      sessionId: message.sessionId,
      runId: message.runId,
      actionId: job.actionId ?? message.id,
      tags: ['runtime', 'message', message.role],
      metadata: { ...metadataWithJob(job), role: message.role, toolName: message.toolName },
    })
    return
  }

  if (job.sourceType === 'memory') {
    const memory = await memoryRepo.getById(job.sourceId)
    if (!memory) return indexerRepo.markDeleted('memory', job.sourceId)
    await upsertTextDocument({
      sourceType: 'memory',
      sourceId: memory.id,
      title: `${memory.kind} memory`,
      text: memory.content,
      sessionId: memory.sourceSession,
      actionId: job.actionId ?? memory.id,
      tags: ['runtime', 'memory', memory.kind],
      metadata: { ...metadataWithJob(job), importance: memory.importance },
    })
    return
  }

  if (job.sourceType === 'skill') {
    const skill = await skillsRepo.getById(job.sourceId)
    if (!skill) return indexerRepo.markDeleted('skill', job.sourceId)
    await upsertTextDocument({
      sourceType: 'skill',
      sourceId: skill.id,
      path: skill.path,
      title: skill.name,
      text: `${skill.name}\n${skill.description ?? ''}\n\n${skill.bodyMd}`,
      actionId: job.actionId ?? skill.id,
      tags: ['runtime', 'skill', skill.source],
      metadata: { ...metadataWithJob(job), slug: skill.slug, enabled: skill.enabled },
    })
    return
  }

  if (job.sourceType === 'session') {
    const session = await sessionsRepo.getById(job.sourceId)
    if (!session) return indexerRepo.markDeleted('session', job.sourceId)
    await upsertTextDocument({
      sourceType: 'session',
      sourceId: session.id,
      title: session.title,
      text: [session.title, session.groupName ?? '', session.archived ? 'archived' : 'active'].join('\n'),
      sessionId: session.id,
      actionId: job.actionId ?? session.id,
      tags: ['runtime', 'session'],
      metadata: { ...metadataWithJob(job), profileId: session.profileId, pinned: session.pinned },
    })
    return
  }

  if (job.sourceType === 'cron_job') {
    const cron = await cronRepo.getJob(job.sourceId)
    if (!cron) return indexerRepo.markDeleted('cron_job', job.sourceId)
    await upsertTextDocument({
      sourceType: 'cron_job',
      sourceId: cron.id,
      title: cron.name,
      text: [cron.name, cron.schedule, cron.timezone, cron.prompt].join('\n'),
      actionId: job.actionId ?? cron.id,
      tags: ['runtime', 'cron_job'],
      metadata: {
        ...metadataWithJob(job),
        enabled: cron.enabled,
        mcpServerIds: cron.mcpServerIds,
        skillIds: cron.skillIds,
      },
    })
    return
  }

  if (job.sourceType === 'run_event') {
    const event = await runEventsRepo.getById(job.sourceId)
    if (!event) return indexerRepo.markDeleted('run_event', job.sourceId)
    const payloadText =
      typeof event.payload === 'string'
        ? event.payload
        : JSON.stringify(event.payload ?? {}, null, 0)
    await upsertTextDocument({
      sourceType: 'run_event',
      sourceId: event.id,
      title: `${event.eventType} #${event.seq}`,
      text: [event.eventType, `seq=${event.seq}`, payloadText.slice(0, 12_000)].join('\n'),
      sessionId: event.sessionId,
      runId: event.runId,
      actionId: job.actionId ?? event.id,
      tags: ['runtime', 'run_event', event.eventType],
      metadata: { ...metadataWithJob(job), seq: event.seq, eventType: event.eventType },
    })
    return
  }

  if (job.sourceType === 'cowork_task') {
    const taskId = job.sourceId
    const sessions = await sessionsRepo.search(coworkSessionTitle(taskId), 5)
    const session =
      sessions.find((s) => s.title === coworkSessionTitle(taskId)) ??
      (job.sessionId ? await sessionsRepo.getById(job.sessionId) : null)
    if (!session) return indexerRepo.markDeleted('cowork_task', taskId)
    const events = await runEventsRepo.listBySession(session.id)
    const task = restoreCoworkTaskFromEvents(taskId, session.id, events)
    const text = [
      task.goal ?? '',
      task.deliverableType ?? '',
      task.status,
      task.summary ?? '',
      task.error ?? '',
      ...(task.files ?? []),
      ...(task.inputFiles ?? []),
    ]
      .filter(Boolean)
      .join('\n')
    await upsertTextDocument({
      sourceType: 'cowork_task',
      sourceId: taskId,
      title: coworkSessionTitle(taskId),
      text: text || coworkSessionTitle(taskId),
      sessionId: session.id,
      runId: job.runId,
      actionId: job.actionId ?? taskId,
      tags: ['runtime', 'cowork_task', task.status],
      metadata: {
        ...metadataWithJob(job),
        deliverableType: task.deliverableType,
        status: task.status,
        files: task.files,
      },
    })
  }
}

/** High-churn AG-UI stream deltas — skip indexing to protect the queue. */
const SKIP_RUN_EVENT_INDEX = new Set([
  'TEXT_MESSAGE_CONTENT',
  'TOOL_CALL_ARGS',
  'REASONING_MESSAGE_CONTENT',
  'RAW',
])

export function shouldIndexRunEventType(eventType: string): boolean {
  if (!eventType) return false
  if (SKIP_RUN_EVENT_INDEX.has(eventType)) return false
  if (eventType.endsWith('_CONTENT') || eventType.endsWith('_ARGS')) return false
  return true
}

export async function queueRunEventIndex(event: {
  id: string
  eventType: string
  sessionId: string | null
  runId: string
}): Promise<void> {
  if (!shouldIndexRunEventType(event.eventType)) return
  await queueRuntimeRecord('run_event', event.id, {
    sessionId: event.sessionId,
    runId: event.runId,
    priority: -5,
  })
}

export async function queueCoworkTaskIndex(
  taskId: string,
  opts?: { sessionId?: string | null; runId?: string | null; files?: string[] },
): Promise<void> {
  await queueRuntimeRecord('cowork_task', taskId, {
    sessionId: opts?.sessionId ?? null,
    runId: opts?.runId ?? null,
    priority: 1,
  })
  for (const file of opts?.files ?? []) {
    const normalized = normalizePath(file)
    const name = basename(normalized)
    if (!name || name === 'status.json') continue
    const sourceId = normalized.includes('/')
      ? normalized.startsWith('outbox/')
        ? normalized
        : normalizePath(`outbox/${taskId}/${name}`)
      : normalizePath(`outbox/${taskId}/${name}`)
    await queueRuntimeRecord('office_artifact', sourceId, {
      sessionId: opts?.sessionId ?? null,
      runId: opts?.runId ?? null,
      priority: 0,
    })
  }
}

async function indexOfficeArtifact(job: IndexJob): Promise<void> {
  const rel = normalizePath(job.sourceId)
  const coworkRoot = resolveCoworkWorkspace()
  let full: string
  try {
    full = resolve(coworkRoot, rel)
    // Ensure jail relative to cowork workspace.
    toWorkspaceRelative(coworkRoot, rel)
  } catch {
    await indexerRepo.markDeleted('office_artifact', rel)
    return
  }

  let info: Awaited<ReturnType<typeof stat>>
  try {
    info = await stat(full)
  } catch (err) {
    if (isNotFound(err)) {
      await indexerRepo.markDeleted('office_artifact', rel)
      return
    }
    throw err
  }
  if (!info.isFile()) {
    await indexerRepo.markDeleted('office_artifact', rel)
    return
  }
  if (info.size > maxFileBytes()) {
    // Still index metadata for oversized deliverables.
    const taskId = rel.split('/')[1] ?? null
    await upsertTextDocument({
      sourceType: 'office_artifact',
      sourceId: rel,
      path: rel,
      title: basename(rel),
      text: [`Office deliverable: ${basename(rel)}`, taskId ? `taskId=${taskId}` : '', `size=${info.size}`]
        .filter(Boolean)
        .join('\n'),
      sizeBytes: info.size,
      mtime: info.mtime,
      sessionId: job.sessionId,
      runId: job.runId,
      actionId: job.actionId,
      tags: ['office', 'artifact', 'cowork'],
      metadata: { ...metadataWithJob(job), taskId, binaryOrLarge: true },
    })
    return
  }

  let buf: Buffer
  try {
    buf = await readFile(full)
  } catch (err) {
    if (isNotFound(err)) {
      await indexerRepo.markDeleted('office_artifact', rel)
      return
    }
    throw err
  }

  const taskId = rel.split('/')[1] ?? null
  const isBinary = buf.includes(0) || !isTextFile(rel)
  const text = isBinary
    ? [`Office deliverable: ${basename(rel)}`, taskId ? `taskId=${taskId}` : '', `bytes=${info.size}`]
        .filter(Boolean)
        .join('\n')
    : buf.toString('utf8')

  await upsertTextDocument({
    sourceType: 'office_artifact',
    sourceId: rel,
    path: rel,
    title: basename(rel),
    text,
    mimeType: isBinary ? 'application/octet-stream' : 'text/plain',
    sizeBytes: info.size,
    mtime: info.mtime,
    sessionId: job.sessionId,
    runId: job.runId,
    actionId: job.actionId,
    tags: ['office', 'artifact', 'cowork'],
    metadata: { ...metadataWithJob(job), taskId, binary: isBinary },
  })
}

export async function backfillPendingEmbeddings(limit = 8): Promise<number> {
  if (!isLocalEmbeddingEndpoint()) return 0
  const docs = await indexerRepo.listEmbeddingPendingDocuments(limit)
  let updated = 0
  for (const doc of docs) {
    const chunks = await indexerRepo.listChunksForDocument(doc.id)
    const needing = chunks.filter((c) => !c.hasEmbedding && c.content.trim())
    if (needing.length === 0) {
      await indexerRepo.applyChunkEmbeddings(doc.id, [])
      updated++
      continue
    }
    try {
      const vectors = await embedBatchLocal(needing.map((c) => c.content))
      await indexerRepo.applyChunkEmbeddings(
        doc.id,
        needing.map((chunk, i) => ({
          chunkId: chunk.id,
          embedding: vectors[i]!,
        })),
      )
      updated++
    } catch (err) {
      log.warn('Embedding backfill failed', {
        documentId: doc.id,
        sourceType: doc.sourceType,
        sourceId: doc.sourceId,
        error: String(err),
      })
    }
  }
  return updated
}

export async function processIndexJob(job: IndexJob): Promise<void> {
  if (job.operation === 'delete') {
    await indexerRepo.markDeleted(job.sourceType, job.sourceId)
    return
  }
  if (job.sourceType === 'workspace_file') {
    await indexWorkspaceFile(job)
  } else if (job.sourceType === 'office_artifact') {
    await indexOfficeArtifact(job)
  } else {
    await indexRuntimeRecord(job)
  }
}
