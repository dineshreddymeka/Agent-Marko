import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { getDb } from '../client'
import { INDEX_JOBS_CHANNEL, wakeIndexWorkers } from '../../indexer/notify'

export type IndexSourceType =
  | 'workspace_file'
  | 'message'
  | 'memory'
  | 'skill'
  | 'session'
  | 'cron_job'
  | 'run_event'
  | 'cowork_task'
  | 'office_artifact'

export type IndexOperation = 'upsert' | 'delete'

export type IndexChunkInput = {
  chunkIndex: number
  content: string
  embedding?: number[] | null
  tokenEstimate?: number
  lineStart?: number | null
  lineEnd?: number | null
  metadata?: Record<string, unknown>
}

export type IndexDocumentInput = {
  sourceType: IndexSourceType
  sourceId: string
  path?: string | null
  title?: string | null
  contentHash?: string | null
  mimeType?: string | null
  sizeBytes?: number | null
  mtime?: Date | null
  sessionId?: string | null
  runId?: string | null
  userId?: string | null
  actionId?: string | null
  tags?: string[]
  metadata?: Record<string, unknown>
}

export type IndexJob = {
  id: string
  sourceType: IndexSourceType
  sourceId: string
  operation: IndexOperation
  actionId: string | null
  sessionId: string | null
  runId: string | null
  userId: string | null
  metadata: Record<string, unknown>
  attempts: number
  lockToken: string | null
}

export type IndexSearchFilters = {
  topK?: number
  sourceTypes?: IndexSourceType[]
  pathPrefix?: string
  extension?: string
  sessionId?: string
  runId?: string
  userId?: string
  actionId?: string
  from?: Date
  to?: Date
  tags?: string[]
  includeDeleted?: boolean
}

export type IndexSearchResult = {
  kind: IndexSourceType
  id: string
  documentId: string
  chunkId: string
  actionId: string | null
  sessionId: string | null
  runId: string | null
  userId: string | null
  path: string | null
  title: string | null
  snippet: string
  score: number
  lineStart: number | null
  lineEnd: number | null
  sourceType: IndexSourceType
}

type DbRow = Record<string, unknown>

function vectorLiteral(embedding: number[]): string {
  return `[${embedding.join(',')}]`
}

function rowDate(value: unknown): Date | null {
  if (value instanceof Date) return value
  if (typeof value === 'string') return new Date(value)
  return null
}

function escapeLike(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')
}

function rowJob(row: DbRow): IndexJob {
  return {
    id: String(row.id),
    sourceType: String(row.source_type) as IndexSourceType,
    sourceId: String(row.source_id),
    operation: String(row.operation) as IndexOperation,
    actionId: row.action_id == null ? null : String(row.action_id),
    sessionId: row.session_id == null ? null : String(row.session_id),
    runId: row.run_id == null ? null : String(row.run_id),
    userId: row.user_id == null ? null : String(row.user_id),
    metadata: (row.metadata as Record<string, unknown> | null) ?? {},
    attempts: Number(row.attempts ?? 0),
    lockToken: row.lock_token == null ? null : String(row.lock_token),
  }
}

function sourceTypeCondition(sourceTypes: IndexSourceType[]) {
  const normalized = [
    ...new Set(
      sourceTypes.map((t) => ((t as string) === 'file' ? ('workspace_file' as IndexSourceType) : t)),
    ),
  ]
  return sql`d.source_type IN (${sql.join(
    normalized.map((sourceType) => sql`${sourceType}`),
    sql`, `,
  )})`
}

function tagsCondition(tags: string[]) {
  return sql`EXISTS (
    SELECT 1
    FROM jsonb_array_elements_text(d.tags) AS tag(value)
    WHERE tag.value IN (${sql.join(tags.map((tag) => sql`${tag}`), sql`, `)})
  )`
}

function isUniqueViolation(err: unknown): boolean {
  const message = String(err ?? '')
  return message.includes('unique') || message.includes('duplicate key') || message.includes('23505')
}

export const indexerRepo = {
  async getDocument(sourceType: IndexSourceType, sourceId: string): Promise<{
    id: string
    contentHash: string | null
    deletedAt: Date | null
    chunkCount: number
    sessionId: string | null
    runId: string | null
    actionId: string | null
    tags: string[]
  } | null> {
    const db = getDb()
    const rows = await db.execute(sql`
      SELECT
        d.id,
        d.content_hash,
        d.deleted_at,
        d.session_id,
        d.run_id,
        d.action_id,
        d.tags,
        COALESCE(d.chunk_count, (
          SELECT COUNT(*)::int FROM jarvis_index_chunks c WHERE c.document_id = d.id
        )) AS chunk_count
      FROM jarvis_index_documents d
      WHERE d.source_type = ${sourceType} AND d.source_id = ${sourceId}
      LIMIT 1
    `)
    const row = (rows as unknown as DbRow[])[0]
    if (!row) return null
    return {
      id: String(row.id),
      contentHash: row.content_hash == null ? null : String(row.content_hash),
      deletedAt: rowDate(row.deleted_at),
      chunkCount: Number(row.chunk_count ?? 0),
      sessionId: row.session_id == null ? null : String(row.session_id),
      runId: row.run_id == null ? null : String(row.run_id),
      actionId: row.action_id == null ? null : String(row.action_id),
      tags: Array.isArray(row.tags) ? (row.tags as string[]) : [],
    }
  },

  async patchDocumentMeta(
    documentId: string,
    patch: Pick<
      IndexDocumentInput,
      'sessionId' | 'runId' | 'userId' | 'actionId' | 'tags' | 'metadata' | 'title' | 'path' | 'mtime'
    >,
  ): Promise<void> {
    const db = getDb()
    await db.execute(sql`
      UPDATE jarvis_index_documents
      SET
        path = COALESCE(${patch.path ?? null}, path),
        title = COALESCE(${patch.title ?? null}, title),
        mtime = COALESCE(${patch.mtime ?? null}, mtime),
        session_id = COALESCE(${patch.sessionId ?? null}, session_id),
        run_id = COALESCE(${patch.runId ?? null}, run_id),
        user_id = COALESCE(${patch.userId ?? null}, user_id),
        action_id = COALESCE(${patch.actionId ?? null}, action_id),
        tags = COALESCE(${patch.tags ? JSON.stringify(patch.tags) : null}::jsonb, tags),
        metadata = metadata || ${JSON.stringify(patch.metadata ?? {})}::jsonb,
        updated_at = NOW()
      WHERE id = ${documentId}
    `)
  },

  /**
   * Atomically upsert document metadata + replace chunks + set content_hash.
   * Hash is only committed after chunks succeed, so failed embeds cannot lock out retries.
   */
  async upsertDocumentWithChunks(
    input: IndexDocumentInput,
    chunks: IndexChunkInput[],
  ): Promise<string> {
    const db = getDb()
    return db.transaction(async (tx) => {
      const rows = await tx.execute(sql`
        INSERT INTO jarvis_index_documents (
          source_type, source_id, path, title, content_hash, mime_type, size_bytes, mtime,
          session_id, run_id, user_id, action_id, tags, metadata, chunk_count, deleted_at, updated_at
        )
        VALUES (
          ${input.sourceType}, ${input.sourceId}, ${input.path ?? null}, ${input.title ?? null},
          NULL, ${input.mimeType ?? null}, ${input.sizeBytes ?? null},
          ${input.mtime ?? null}, ${input.sessionId ?? null}, ${input.runId ?? null},
          ${input.userId ?? null}, ${input.actionId ?? null}, ${JSON.stringify(input.tags ?? [])}::jsonb,
          ${JSON.stringify(input.metadata ?? {})}::jsonb, 0, NULL, NOW()
        )
        ON CONFLICT (source_type, source_id) DO UPDATE SET
          path = EXCLUDED.path,
          title = EXCLUDED.title,
          mime_type = EXCLUDED.mime_type,
          size_bytes = EXCLUDED.size_bytes,
          mtime = EXCLUDED.mtime,
          session_id = EXCLUDED.session_id,
          run_id = EXCLUDED.run_id,
          user_id = EXCLUDED.user_id,
          action_id = EXCLUDED.action_id,
          tags = EXCLUDED.tags,
          metadata = EXCLUDED.metadata,
          deleted_at = NULL,
          updated_at = NOW()
        RETURNING id
      `)
      const documentId = String((rows as unknown as DbRow[])[0]?.id)
      if (!documentId) throw new Error('Failed to upsert index document')

      await tx.execute(sql`DELETE FROM jarvis_index_chunks WHERE document_id = ${documentId}`)
      for (const chunk of chunks) {
        const vec = chunk.embedding?.length ? vectorLiteral(chunk.embedding) : null
        await tx.execute(sql`
          INSERT INTO jarvis_index_chunks (
            document_id, chunk_index, content, embedding, token_estimate, line_start, line_end, metadata
          )
          VALUES (
            ${documentId}, ${chunk.chunkIndex}, ${chunk.content},
            ${vec}::vector, ${chunk.tokenEstimate ?? Math.ceil(chunk.content.length / 4)},
            ${chunk.lineStart ?? null}, ${chunk.lineEnd ?? null},
            ${JSON.stringify(chunk.metadata ?? {})}::jsonb
          )
        `)
      }

      await tx.execute(sql`
        UPDATE jarvis_index_documents
        SET content_hash = ${input.contentHash ?? null},
            chunk_count = ${chunks.length},
            updated_at = NOW()
        WHERE id = ${documentId}
      `)
      return documentId
    })
  },

  async markDeleted(sourceType: IndexSourceType, sourceId: string): Promise<void> {
    const db = getDb()
    await db.execute(sql`
      UPDATE jarvis_index_documents
      SET deleted_at = NOW(), updated_at = NOW()
      WHERE source_type = ${sourceType} AND source_id = ${sourceId}
    `)
  },

  async recordAction(input: {
    actionId?: string | null
    sessionId?: string | null
    runId?: string | null
    userId?: string | null
    parentActionId?: string | null
    sourceType: IndexSourceType
    sourceId?: string | null
    actionType: string
    summary?: string | null
    metadata?: Record<string, unknown>
  }): Promise<string> {
    const db = getDb()
    const rows = await db.execute(sql`
      INSERT INTO jarvis_index_actions (
        action_id, session_id, run_id, user_id, parent_action_id, source_type, source_id,
        action_type, summary, metadata
      )
      VALUES (
        COALESCE(${input.actionId ?? null}::uuid, gen_random_uuid()),
        ${input.sessionId ?? null}, ${input.runId ?? null}, ${input.userId ?? null},
        ${input.parentActionId ?? null}, ${input.sourceType}, ${input.sourceId ?? null},
        ${input.actionType}, ${input.summary ?? null}, ${JSON.stringify(input.metadata ?? {})}::jsonb
      )
      ON CONFLICT (action_id) DO UPDATE SET
        summary = EXCLUDED.summary,
        metadata = EXCLUDED.metadata
      RETURNING action_id
    `)
    const row = (rows as unknown as DbRow[])[0]
    if (!row) throw new Error('Failed to record index action')
    return String(row.action_id)
  },

  async linkAction(input: {
    actionId: string
    documentId?: string | null
    chunkId?: string | null
    targetType: string
    targetId: string
    relation?: string
  }): Promise<void> {
    const db = getDb()
    await db.execute(sql`
      INSERT INTO jarvis_index_action_links (
        action_id, document_id, chunk_id, target_type, target_id, relation
      )
      VALUES (
        ${input.actionId}, ${input.documentId ?? null}, ${input.chunkId ?? null},
        ${input.targetType}, ${input.targetId}, ${input.relation ?? 'touched'}
      )
      ON CONFLICT DO NOTHING
    `).catch(async () => {
      // Unique constraint may not exist yet; fall back to insert-if-missing.
      await db.execute(sql`
        INSERT INTO jarvis_index_action_links (
          action_id, document_id, chunk_id, target_type, target_id, relation
        )
        SELECT
          ${input.actionId}, ${input.documentId ?? null}, ${input.chunkId ?? null},
          ${input.targetType}, ${input.targetId}, ${input.relation ?? 'touched'}
        WHERE NOT EXISTS (
          SELECT 1 FROM jarvis_index_action_links
          WHERE action_id = ${input.actionId}
            AND target_type = ${input.targetType}
            AND target_id = ${input.targetId}
        )
      `)
    })
  },

  async enqueueJob(input: {
    sourceType: IndexSourceType
    sourceId: string
    operation?: IndexOperation
    actionId?: string | null
    sessionId?: string | null
    runId?: string | null
    userId?: string | null
    metadata?: Record<string, unknown>
    priority?: number
  }): Promise<void> {
    const db = getDb()
    const operation = input.operation ?? 'upsert'
    const metadataJson = JSON.stringify(input.metadata ?? {})
    const priority = input.priority ?? 0

    // Never clear a running lock — request a rerun after the current worker finishes.
    const running = await db.execute(sql`
      UPDATE index_jobs
      SET operation = ${operation},
          action_id = COALESCE(${input.actionId ?? null}, action_id),
          session_id = COALESCE(${input.sessionId ?? null}, session_id),
          run_id = COALESCE(${input.runId ?? null}, run_id),
          user_id = COALESCE(${input.userId ?? null}, user_id),
          metadata = metadata || ${metadataJson}::jsonb,
          priority = GREATEST(priority, ${priority}),
          rerun_requested = TRUE,
          updated_at = NOW()
      WHERE source_type = ${input.sourceType}
        AND source_id = ${input.sourceId}
        AND status = 'running'
      RETURNING id
    `)
    if ((running as unknown[]).length > 0) {
      wakeIndexWorkers()
      return
    }

    // Coalesce pending job; last operation wins.
    const pending = await db.execute(sql`
      UPDATE index_jobs
      SET operation = ${operation},
          action_id = COALESCE(${input.actionId ?? null}, action_id),
          session_id = COALESCE(${input.sessionId ?? null}, session_id),
          run_id = COALESCE(${input.runId ?? null}, run_id),
          user_id = COALESCE(${input.userId ?? null}, user_id),
          metadata = metadata || ${metadataJson}::jsonb,
          priority = GREATEST(priority, ${priority}),
          next_attempt_at = NOW(),
          locked_at = NULL,
          lock_token = NULL,
          updated_at = NOW()
      WHERE source_type = ${input.sourceType}
        AND source_id = ${input.sourceId}
        AND status = 'pending'
      RETURNING id
    `)
    if ((pending as unknown[]).length > 0) {
      await db.execute(sql`SELECT pg_notify(${INDEX_JOBS_CHANNEL}, ${'1'})`)
      wakeIndexWorkers()
      return
    }

    // Revive latest failed job instead of inserting a duplicate.
    const failed = await db.execute(sql`
      UPDATE index_jobs
      SET status = 'pending',
          operation = ${operation},
          action_id = COALESCE(${input.actionId ?? null}, action_id),
          session_id = COALESCE(${input.sessionId ?? null}, session_id),
          run_id = COALESCE(${input.runId ?? null}, run_id),
          user_id = COALESCE(${input.userId ?? null}, user_id),
          metadata = metadata || ${metadataJson}::jsonb,
          priority = GREATEST(priority, ${priority}),
          attempts = 0,
          last_error = NULL,
          next_attempt_at = NOW(),
          locked_at = NULL,
          lock_token = NULL,
          rerun_requested = FALSE,
          updated_at = NOW()
      WHERE id = (
        SELECT id FROM index_jobs
        WHERE source_type = ${input.sourceType}
          AND source_id = ${input.sourceId}
          AND status = 'failed'
        ORDER BY updated_at DESC
        LIMIT 1
      )
      RETURNING id
    `)
    if ((failed as unknown[]).length > 0) {
      await db.execute(sql`SELECT pg_notify(${INDEX_JOBS_CHANNEL}, ${'1'})`)
      wakeIndexWorkers()
      return
    }

    await db.execute(sql`
      INSERT INTO index_jobs (
        source_type, source_id, operation, action_id, session_id, run_id, user_id, metadata,
        priority, next_attempt_at, status, rerun_requested
      )
      VALUES (
        ${input.sourceType}, ${input.sourceId}, ${operation},
        ${input.actionId ?? null}, ${input.sessionId ?? null}, ${input.runId ?? null},
        ${input.userId ?? null}, ${metadataJson}::jsonb,
        ${priority}, NOW(), 'pending', FALSE
      )
    `).catch(async (err) => {
      if (!isUniqueViolation(err)) throw err
      const coalesced = await db.execute(sql`
        UPDATE index_jobs
        SET operation = ${operation},
            priority = GREATEST(priority, ${priority}),
            next_attempt_at = NOW(),
            updated_at = NOW()
        WHERE source_type = ${input.sourceType}
          AND source_id = ${input.sourceId}
          AND status = 'pending'
        RETURNING id
      `)
      if ((coalesced as unknown[]).length === 0) throw err
    })

    await db.execute(sql`SELECT pg_notify(${INDEX_JOBS_CHANNEL}, ${'1'})`)
    wakeIndexWorkers()
  },

  async claimJobs(limit = 16): Promise<IndexJob[]> {
    const db = getDb()
    const rows = await db.execute(sql`
      UPDATE index_jobs
      SET status = 'running',
          attempts = attempts + 1,
          locked_at = NOW(),
          lock_token = gen_random_uuid(),
          updated_at = NOW()
      WHERE id IN (
        SELECT id
        FROM index_jobs
        WHERE (status = 'pending' AND next_attempt_at <= NOW())
           OR (status = 'running' AND locked_at < NOW() - INTERVAL '5 minutes')
        ORDER BY priority DESC, created_at ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id, source_type, source_id, operation, action_id, session_id, run_id, user_id,
                metadata, attempts, lock_token
    `)
    return (rows as unknown as DbRow[]).map(rowJob)
  },

  async completeJob(
    id: string,
    lockToken: string | null,
  ): Promise<{ rerunRequested: boolean; operation: IndexOperation; sourceType: IndexSourceType; sourceId: string }> {
    const db = getDb()
    const rows = await db.execute(sql`
      UPDATE index_jobs
      SET status = 'done',
          locked_at = NULL,
          lock_token = NULL,
          updated_at = NOW()
      WHERE id = ${id}
        AND (${lockToken ?? null}::uuid IS NULL OR lock_token = ${lockToken ?? null}::uuid)
      RETURNING rerun_requested, operation, source_type, source_id, action_id, session_id, run_id, user_id, metadata, priority
    `)
    const row = (rows as unknown as DbRow[])[0]
    return {
      rerunRequested: Boolean(row?.rerun_requested),
      operation: String(row?.operation ?? 'upsert') as IndexOperation,
      sourceType: String(row?.source_type ?? 'workspace_file') as IndexSourceType,
      sourceId: String(row?.source_id ?? ''),
    }
  },

  async failJob(id: string, lockToken: string | null, error: unknown): Promise<void> {
    const db = getDb()
    const rows = await db.execute(sql`
      UPDATE index_jobs
      SET status = CASE WHEN attempts >= 5 THEN 'failed' ELSE 'pending' END,
          last_error = ${String(error).slice(0, 2000)},
          locked_at = NULL,
          lock_token = NULL,
          next_attempt_at = CASE
            WHEN attempts >= 5 THEN next_attempt_at
            ELSE NOW() + make_interval(secs => LEAST(300, POWER(2, attempts)::int * 5))
          END,
          updated_at = NOW()
      WHERE id = ${id}
        AND (${lockToken ?? null}::uuid IS NULL OR lock_token = ${lockToken ?? null}::uuid)
      RETURNING status, next_attempt_at, attempts
    `)
    const row = (rows as unknown as DbRow[])[0]
    if (row && String(row.status) === 'pending') {
      const nextAt = rowDate(row.next_attempt_at)
      const delayMs = nextAt ? Math.max(0, nextAt.getTime() - Date.now()) : 0
      await db.execute(sql`SELECT pg_notify(${INDEX_JOBS_CHANNEL}, ${'1'})`).catch(() => undefined)
      wakeIndexWorkers(Math.min(delayMs + 25, 300_000))
    }
  },

  async status(): Promise<{
    queueDepth: number
    retryingJobs: number
    failedJobs: number
    indexedDocuments: number
    indexedChunks: number
    lastIndexedAt: string | null
  }> {
    const db = getDb()
    const rows = await db.execute(sql`
      SELECT
        (SELECT COUNT(*)::int FROM index_jobs WHERE status IN ('pending', 'running')) AS queue_depth,
        (SELECT COUNT(*)::int FROM index_jobs WHERE status = 'pending' AND next_attempt_at > NOW()) AS retrying_jobs,
        (SELECT COUNT(*)::int FROM index_jobs WHERE status = 'failed') AS failed_jobs,
        (SELECT COUNT(*)::int FROM jarvis_index_documents WHERE deleted_at IS NULL) AS indexed_documents,
        (SELECT COUNT(*)::int FROM jarvis_index_chunks c JOIN jarvis_index_documents d ON d.id = c.document_id WHERE d.deleted_at IS NULL) AS indexed_chunks,
        (SELECT MAX(updated_at) FROM jarvis_index_documents) AS last_indexed_at
    `)
    const row = (rows as unknown as DbRow[])[0] ?? {}
    const lastIndexedAt = rowDate(row.last_indexed_at)
    return {
      queueDepth: Number(row.queue_depth ?? 0),
      retryingJobs: Number(row.retrying_jobs ?? 0),
      failedJobs: Number(row.failed_jobs ?? 0),
      indexedDocuments: Number(row.indexed_documents ?? 0),
      indexedChunks: Number(row.indexed_chunks ?? 0),
      lastIndexedAt: lastIndexedAt?.toISOString() ?? null,
    }
  },

  async search(
    query: string,
    embedding: number[] | null,
    filters: IndexSearchFilters = {},
  ): Promise<IndexSearchResult[]> {
    const db = getDb()
    const q = query.trim()
    const topK = Math.max(1, Math.min(Number(filters.topK ?? 20), 100))
    const candidateLimit = Math.min(200, Math.max(50, topK * 5))
    const conditions = [filters.includeDeleted ? sql`TRUE` : sql`d.deleted_at IS NULL`]
    if (filters.sourceTypes?.length) conditions.push(sourceTypeCondition(filters.sourceTypes))
    if (filters.pathPrefix) {
      conditions.push(sql`d.path LIKE ${escapeLike(filters.pathPrefix.replace(/\\/g, '/')) + '%'} ESCAPE '\\'`)
    }
    if (filters.extension) {
      const ext = filters.extension.startsWith('.') ? filters.extension : `.${filters.extension}`
      conditions.push(sql`d.path ~* ${ext.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$'}`)
    }
    if (filters.sessionId) conditions.push(sql`d.session_id = ${filters.sessionId}`)
    if (filters.runId) conditions.push(sql`d.run_id = ${filters.runId}`)
    if (filters.userId) conditions.push(sql`d.user_id = ${filters.userId}`)
    if (filters.actionId) conditions.push(sql`d.action_id = ${filters.actionId}`)
    if (filters.from) conditions.push(sql`COALESCE(d.mtime, d.updated_at) >= ${filters.from}`)
    if (filters.to) conditions.push(sql`COALESCE(d.mtime, d.updated_at) <= ${filters.to}`)
    if (filters.tags?.length) conditions.push(tagsCondition(filters.tags))

    const where = sql`WHERE ${sql.join(conditions, sql` AND `)}`
    const vec = embedding?.length ? vectorLiteral(embedding) : null
    const hasEmbedding = vec != null
    const hasQuery = q.length > 0
    const vectorOrder = hasEmbedding ? sql`c.embedding <=> ${vec}::vector` : sql`0`
    const vectorScoreExpr = hasEmbedding
      ? sql`CASE WHEN c.embedding IS NOT NULL THEN 1 / (1 + (c.embedding <=> ${vec}::vector)) ELSE 0 END`
      : sql`0`

    const rows = await db.execute(sql`
      WITH
      fts_hits AS (
        SELECT c.id AS chunk_id
        FROM jarvis_index_chunks c
        JOIN jarvis_index_documents d ON d.id = c.document_id
        ${where}
          AND ${hasQuery}
          AND c.search @@ plainto_tsquery('english', ${q})
        ORDER BY ts_rank_cd(c.search, plainto_tsquery('english', ${q})) DESC
        LIMIT ${candidateLimit}
      ),
      vector_hits AS (
        SELECT c.id AS chunk_id
        FROM jarvis_index_chunks c
        JOIN jarvis_index_documents d ON d.id = c.document_id
        ${where}
          AND ${hasEmbedding}
          AND c.embedding IS NOT NULL
        ORDER BY ${vectorOrder}
        LIMIT ${candidateLimit}
      ),
      recent_hits AS (
        SELECT c.id AS chunk_id
        FROM jarvis_index_chunks c
        JOIN jarvis_index_documents d ON d.id = c.document_id
        ${where}
          AND NOT ${hasQuery}
          AND NOT ${hasEmbedding}
        ORDER BY COALESCE(d.mtime, d.updated_at) DESC NULLS LAST
        LIMIT ${candidateLimit}
      ),
      candidates AS (
        SELECT chunk_id FROM fts_hits
        UNION
        SELECT chunk_id FROM vector_hits
        UNION
        SELECT chunk_id FROM recent_hits
      ),
      ranked AS (
        SELECT
          d.source_type,
          d.source_id,
          d.id AS document_id,
          c.id AS chunk_id,
          d.action_id,
          d.session_id,
          d.run_id,
          d.user_id,
          d.path,
          d.title,
          c.content,
          c.line_start,
          c.line_end,
          ${vectorScoreExpr} AS vector_score,
          CASE
            WHEN ${hasQuery} AND c.search @@ plainto_tsquery('english', ${q})
              THEN ts_rank_cd(c.search, plainto_tsquery('english', ${q}))
            ELSE 0
          END AS fts_score,
          CASE
            WHEN d.session_id IS NOT NULL AND ${filters.sessionId ?? null}::uuid IS NOT NULL
              AND d.session_id = ${filters.sessionId ?? null}::uuid THEN 0.15
            WHEN d.run_id IS NOT NULL AND ${filters.runId ?? null}::uuid IS NOT NULL
              AND d.run_id = ${filters.runId ?? null}::uuid THEN 0.1
            WHEN d.action_id IS NOT NULL AND ${filters.actionId ?? null}::uuid IS NOT NULL
              AND d.action_id = ${filters.actionId ?? null}::uuid THEN 0.1
            ELSE 0
          END AS linked_score,
          CASE
            WHEN COALESCE(d.mtime, d.updated_at) > NOW() - INTERVAL '7 days' THEN 0.05
            WHEN COALESCE(d.mtime, d.updated_at) > NOW() - INTERVAL '30 days' THEN 0.025
            ELSE 0
          END AS recency_score
        FROM candidates cand
        JOIN jarvis_index_chunks c ON c.id = cand.chunk_id
        JOIN jarvis_index_documents d ON d.id = c.document_id
      )
      SELECT *,
        (vector_score * 0.65 + fts_score * 0.3 + linked_score + recency_score) AS score
      FROM ranked
      ORDER BY score DESC, document_id ASC, line_start ASC NULLS LAST
      LIMIT ${topK}
    `)

    return (rows as unknown as DbRow[]).map((row) => ({
      kind: String(row.source_type) as IndexSourceType,
      id: String(row.source_id),
      documentId: String(row.document_id),
      chunkId: String(row.chunk_id),
      actionId: row.action_id == null ? null : String(row.action_id),
      sessionId: row.session_id == null ? null : String(row.session_id),
      runId: row.run_id == null ? null : String(row.run_id),
      userId: row.user_id == null ? null : String(row.user_id),
      path: row.path == null ? null : String(row.path),
      title: row.title == null ? null : String(row.title),
      snippet: String(row.content ?? '').slice(0, 500),
      score: Number(row.score ?? 0),
      lineStart: row.line_start == null ? null : Number(row.line_start),
      lineEnd: row.line_end == null ? null : Number(row.line_end),
      sourceType: String(row.source_type) as IndexSourceType,
    }))
  },

  async listEmbeddingPendingDocuments(limit = 8): Promise<
    Array<{ id: string; sourceType: IndexSourceType; sourceId: string }>
  > {
    const db = getDb()
    const rows = await db.execute(sql`
      SELECT d.id, d.source_type, d.source_id
      FROM jarvis_index_documents d
      WHERE d.deleted_at IS NULL
        AND (
          COALESCE(d.metadata->>'embeddingPending', 'false') = 'true'
          OR EXISTS (
            SELECT 1 FROM jarvis_index_chunks c
            WHERE c.document_id = d.id AND c.embedding IS NULL
          )
        )
      ORDER BY d.updated_at ASC
      LIMIT ${Math.max(1, Math.min(limit, 32))}
    `)
    return (rows as unknown as DbRow[]).map((row) => ({
      id: String(row.id),
      sourceType: String(row.source_type) as IndexSourceType,
      sourceId: String(row.source_id),
    }))
  },

  async listChunksForDocument(
    documentId: string,
  ): Promise<Array<{ id: string; chunkIndex: number; content: string; hasEmbedding: boolean }>> {
    const db = getDb()
    const rows = await db.execute(sql`
      SELECT id, chunk_index, content, (embedding IS NOT NULL) AS has_embedding
      FROM jarvis_index_chunks
      WHERE document_id = ${documentId}
      ORDER BY chunk_index ASC
    `)
    return (rows as unknown as DbRow[]).map((row) => ({
      id: String(row.id),
      chunkIndex: Number(row.chunk_index ?? 0),
      content: String(row.content ?? ''),
      hasEmbedding: Boolean(row.has_embedding),
    }))
  },

  async applyChunkEmbeddings(
    documentId: string,
    updates: Array<{ chunkId: string; embedding: number[] }>,
  ): Promise<void> {
    const db = getDb()
    await db.transaction(async (tx) => {
      for (const update of updates) {
        await tx.execute(sql`
          UPDATE jarvis_index_chunks
          SET embedding = ${vectorLiteral(update.embedding)}::vector
          WHERE id = ${update.chunkId} AND document_id = ${documentId}
        `)
      }
      await tx.execute(sql`
        UPDATE jarvis_index_documents
        SET metadata = (metadata - 'embeddingPending') || '{"embeddingPending":false}'::jsonb,
            updated_at = NOW()
        WHERE id = ${documentId}
      `)
    })
  },

  async prune(days = 30): Promise<{ jobs: number; documents: number }> {
    const db = getDb()
    const safeDays = Math.max(1, Math.min(Number(days) || 30, 3650))
    const jobs = await db.execute(sql`
      DELETE FROM index_jobs
      WHERE status IN ('done', 'failed')
        AND updated_at < NOW() - make_interval(days => ${safeDays})
      RETURNING id
    `)
    const docs = await db.execute(sql`
      DELETE FROM jarvis_index_documents
      WHERE deleted_at IS NOT NULL
        AND deleted_at < NOW() - make_interval(days => ${safeDays})
      RETURNING id
    `)
    return {
      jobs: (jobs as unknown[]).length,
      documents: (docs as unknown[]).length,
    }
  },
}

/** Used by enqueue helpers that need a fresh UUID without importing crypto everywhere. */
export function newIndexActionId(): string {
  return randomUUID()
}
