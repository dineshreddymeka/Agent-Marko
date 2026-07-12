import { describe, expect, test, beforeAll, afterEach } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { getDb } from '../src/db/client'
import { indexerRepo } from '../src/db/repositories/indexer'
import { isIntegrationEnabled, prepareIntegrationDb, truncateAppTables } from './helpers/db'

const enabled = await isIntegrationEnabled()

describe.skipIf(!enabled)('jarvis indexer integrity (integration)', () => {
  beforeAll(async () => {
    await prepareIntegrationDb()
  })

  afterEach(async () => {
    await truncateAppTables()
  })

  test('upsertDocumentWithChunks commits hash only with chunks', async () => {
    const sourceId = `src/${randomUUID()}.ts`
    const documentId = await indexerRepo.upsertDocumentWithChunks(
      {
        sourceType: 'workspace_file',
        sourceId,
        path: sourceId,
        title: 'demo.ts',
        contentHash: 'hash-v1',
        tags: ['workspace'],
      },
      [
        {
          chunkIndex: 0,
          content: 'const x = 1',
          embedding: null,
          lineStart: 1,
          lineEnd: 1,
        },
      ],
    )
    expect(documentId).toBeTruthy()

    const doc = await indexerRepo.getDocument('workspace_file', sourceId)
    expect(doc?.contentHash).toBe('hash-v1')
    expect(doc?.chunkCount).toBe(1)
  })

  test('enqueue while running sets rerun_requested and does not clear lock', async () => {
    const sourceId = `mem-${randomUUID()}`
    await indexerRepo.enqueueJob({
      sourceType: 'memory',
      sourceId,
      operation: 'upsert',
      priority: 0,
    })
    const [claimed] = await indexerRepo.claimJobs(1)
    expect(claimed?.sourceId).toBe(sourceId)
    expect(claimed?.lockToken).toBeTruthy()

    await indexerRepo.enqueueJob({
      sourceType: 'memory',
      sourceId,
      operation: 'delete',
      priority: 5,
    })

    const db = getDb()
    const rows = await db.execute(sql`
      SELECT status, operation, rerun_requested, lock_token
      FROM index_jobs
      WHERE id = ${claimed!.id}
    `)
    const row = (rows as unknown as Array<Record<string, unknown>>)[0]
    expect(String(row?.status)).toBe('running')
    expect(String(row?.operation)).toBe('delete')
    expect(Boolean(row?.rerun_requested)).toBe(true)
    expect(String(row?.lock_token)).toBe(claimed!.lockToken)
  })

  test('completeJob fencing ignores mismatched lock token', async () => {
    const sourceId = `skill-${randomUUID()}`
    await indexerRepo.enqueueJob({
      sourceType: 'skill',
      sourceId,
      operation: 'upsert',
    })
    const [claimed] = await indexerRepo.claimJobs(1)
    expect(claimed?.lockToken).toBeTruthy()

    const ignored = await indexerRepo.completeJob(claimed!.id, randomUUID())
    expect(ignored.sourceId).toBe('')

    const ok = await indexerRepo.completeJob(claimed!.id, claimed!.lockToken)
    expect(ok.sourceId).toBe(sourceId)
  })

  test('failed job is revived on re-enqueue', async () => {
    const sourceId = `session-${randomUUID()}`
    await indexerRepo.enqueueJob({
      sourceType: 'session',
      sourceId,
      operation: 'upsert',
    })
    const [claimed] = await indexerRepo.claimJobs(1)
    // Force terminal failure by bumping attempts then failing.
    const db = getDb()
    await db.execute(sql`
      UPDATE index_jobs SET attempts = 5 WHERE id = ${claimed!.id}
    `)
    await indexerRepo.failJob(claimed!.id, claimed!.lockToken, new Error('boom'))

    const failed = await db.execute(sql`
      SELECT status FROM index_jobs WHERE id = ${claimed!.id}
    `)
    expect(String((failed as unknown as Array<Record<string, unknown>>)[0]?.status)).toBe('failed')

    await indexerRepo.enqueueJob({
      sourceType: 'session',
      sourceId,
      operation: 'upsert',
      priority: 2,
    })

    const revived = await db.execute(sql`
      SELECT status, attempts, priority
      FROM index_jobs
      WHERE source_type = 'session' AND source_id = ${sourceId} AND status = 'pending'
    `)
    const row = (revived as unknown as Array<Record<string, unknown>>)[0]
    expect(row).toBeTruthy()
    expect(Number(row?.attempts)).toBe(0)
    expect(Number(row?.priority)).toBeGreaterThanOrEqual(2)
  })

  test('search filters by pathPrefix and sourceTypes with FTS when no embedding', async () => {
    const pathA = `src/${randomUUID()}/alpha.ts`
    const pathB = `docs/${randomUUID()}/readme.md`
    await indexerRepo.upsertDocumentWithChunks(
      {
        sourceType: 'workspace_file',
        sourceId: pathA,
        path: pathA,
        title: 'alpha.ts',
        contentHash: 'hash-a',
        tags: ['code'],
        metadata: { embeddingPending: true },
      },
      [{ chunkIndex: 0, content: 'unique alpha widget factory', embedding: null }],
    )
    await indexerRepo.upsertDocumentWithChunks(
      {
        sourceType: 'workspace_file',
        sourceId: pathB,
        path: pathB,
        title: 'readme.md',
        contentHash: 'hash-b',
        tags: ['docs'],
      },
      [{ chunkIndex: 0, content: 'unique alpha widget factory in docs', embedding: null }],
    )

    const hits = await indexerRepo.search('unique alpha widget', null, {
      topK: 10,
      sourceTypes: ['workspace_file'],
      pathPrefix: 'src/',
    })
    expect(hits.length).toBeGreaterThan(0)
    expect(hits.every((hit) => hit.path?.startsWith('src/'))).toBe(true)
    expect(hits.some((hit) => hit.path === pathA)).toBe(true)
    expect(hits.some((hit) => hit.path === pathB)).toBe(false)
  })

  test('embeddingPending metadata is preserved on FTS-only upsert', async () => {
    const sourceId = `pending/${randomUUID()}.ts`
    await indexerRepo.upsertDocumentWithChunks(
      {
        sourceType: 'workspace_file',
        sourceId,
        path: sourceId,
        contentHash: 'pending-hash',
        metadata: { embeddingPending: true },
      },
      [{ chunkIndex: 0, content: 'pending embedding body', embedding: null }],
    )
    const doc = await indexerRepo.getDocument('workspace_file', sourceId)
    expect(doc?.chunkCount).toBe(1)
    const db = getDb()
    const rows = await db.execute(sql`
      SELECT metadata->>'embeddingPending' AS pending
      FROM jarvis_index_documents
      WHERE source_type = 'workspace_file' AND source_id = ${sourceId}
    `)
    expect(String((rows as unknown as Array<Record<string, unknown>>)[0]?.pending)).toBe('true')
  })
})
