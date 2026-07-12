import { createHash, randomUUID } from 'node:crypto'
import { readdir, readFile, stat } from 'node:fs/promises'
import { basename, extname, join, relative, resolve } from 'node:path'
import { config } from '../config'
import { indexerRepo, type IndexJob, type IndexSourceType } from '../db/repositories/indexer'
import { messagesRepo } from '../db/repositories/messages'
import { memoryRepo } from '../db/repositories/memory'
import { skillsRepo } from '../db/repositories/skills'
import { sessionsRepo } from '../db/repositories/sessions'
import { cronRepo } from '../db/repositories/cron'
import { toWorkspaceRelative } from '../fs/path-jail'
import { logger } from '../log'
import { chunkText } from './chunker'
import { embedBatchLocal } from './local-embeddings'

const log = logger.child({ component: 'indexer' })

const TEXT_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.json',
  '.md',
  '.txt',
  '.sql',
  '.css',
  '.html',
  '.yml',
  '.yaml',
  '.toml',
  '.py',
  '.rs',
  '.go',
  '.java',
  '.c',
  '.cpp',
  '.h',
  '.cs',
  '.sh',
  '.ps1',
  '.gitignore',
  '.dockerfile',
])

const IGNORED_SEGMENTS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  '.next',
  '.turbo',
  'coverage',
  '.cache',
])

/** Explicit secret filenames only — avoid matching keyboard.tsx / monkey.ts. */
const SECRET_NAME_RE =
  /(^|[/.\\])(\.env(\..+)?|.*\.pem|id_rsa|id_ed25519|credentials\.json|secrets?\.(json|ya?ml|toml|env)|.*\.key)$/i
const MAX_FILE_BYTES = 512 * 1024

function workspaceRoot(): string {
  return resolve(config.WORKSPACE_ROOT)
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '')
}

function workspaceRelative(path: string): string {
  return normalizePath(toWorkspaceRelative(workspaceRoot(), path))
}

function hashText(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

export function isIgnoredPath(rel: string): boolean {
  const normalized = normalizePath(rel)
  const parts = normalized.split('/')
  if (parts.some((part) => IGNORED_SEGMENTS.has(part))) return true
  if (SECRET_NAME_RE.test(normalized)) return true
  return false
}

function isTextFile(rel: string): boolean {
  const lower = rel.toLowerCase()
  const ext = extname(lower)
  return TEXT_EXTENSIONS.has(ext) || TEXT_EXTENSIONS.has(basename(lower))
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

  const textChunks = chunkText(input.text)
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
  sourceType: Extract<IndexSourceType, 'message' | 'memory' | 'skill' | 'session' | 'cron_job'>,
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
  sourceType: Extract<IndexSourceType, 'message' | 'memory' | 'skill' | 'session' | 'cron_job'>,
  sourceId: string,
): Promise<void> {
  await indexerRepo.enqueueJob({
    sourceType,
    sourceId,
    operation: 'delete',
    priority: 5,
  })
}

export async function scanWorkspace(): Promise<number> {
  const root = workspaceRoot()
  let queued = 0
  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      const full = join(dir, entry.name)
      const rel = normalizePath(relative(root, full))
      if (isIgnoredPath(rel)) continue
      if (entry.isDirectory()) {
        await walk(full)
      } else if (entry.isFile() && isTextFile(rel)) {
        await indexerRepo.enqueueJob({
          sourceType: 'workspace_file',
          sourceId: rel,
          operation: 'upsert',
          priority: -10,
        })
        queued++
      }
    }
  }
  await walk(root)
  log.info('Workspace scan queued index jobs', { queued, root })
  return queued
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
  if (!info.isFile() || info.size > MAX_FILE_BYTES) {
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
  }
}

export async function processIndexJob(job: IndexJob): Promise<void> {
  if (job.operation === 'delete') {
    await indexerRepo.markDeleted(job.sourceType, job.sourceId)
    return
  }
  if (job.sourceType === 'workspace_file') {
    await indexWorkspaceFile(job)
  } else {
    await indexRuntimeRecord(job)
  }
}
