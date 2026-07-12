import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { chunkText } from '../src/indexer/chunker'
import { INDEX_JOBS_CHANNEL, onIndexJobWake, wakeIndexWorkers } from '../src/indexer/notify'
import { formatRecallSnippet } from '../src/indexer/retriever'

describe('indexer chunker', () => {
  test('splits text into ordered chunks with line ranges', () => {
    const text = Array.from({ length: 20 }, (_, i) => `line ${i + 1}: ${'x'.repeat(20)}`).join('\n')
    const chunks = chunkText(text, { maxChars: 120, overlapChars: 20 })

    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks[0]?.chunkIndex).toBe(0)
    expect(chunks[0]?.lineStart).toBe(1)
    expect(chunks.every((chunk, i) => chunk.chunkIndex === i)).toBe(true)
    expect(chunks.every((chunk) => chunk.tokenEstimate > 0)).toBe(true)
  })

  test('returns no chunks for blank text', () => {
    expect(chunkText(' \n\n ')).toEqual([])
  })
})

describe('recall formatting', () => {
  test('includes source, location, session, run, and snippet', () => {
    const formatted = formatRecallSnippet({
      kind: 'workspace_file',
      id: 'src/app.ts',
      documentId: 'doc',
      chunkId: 'chunk',
      actionId: '00000000-0000-4000-8000-000000000003',
      sessionId: '00000000-0000-4000-8000-000000000001',
      runId: '00000000-0000-4000-8000-000000000002',
      userId: null,
      path: 'src/app.ts',
      title: 'app.ts',
      snippet: 'const app = createApp()',
      score: 1,
      lineStart: 12,
      lineEnd: 12,
      sourceType: 'workspace_file',
    })

    expect(formatted).toContain('[workspace_file] src/app.ts:12')
    expect(formatted).toContain('session=00000000-0000-4000-8000-000000000001')
    expect(formatted).toContain('run=00000000-0000-4000-8000-000000000002')
    expect(formatted).toContain('const app = createApp()')
  })
})

describe('indexer migration', () => {
  test('defines durable retry scheduling for async watcher jobs', () => {
    const sql = readFileSync(join(import.meta.dir, '../migrations/0008_jarvis_indexer.sql'), 'utf8')

    expect(sql).toContain('next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW()')
    expect(sql).toContain('index_jobs_retry_idx')
    expect(sql).toContain('index_jobs_claim_idx')
  })

  test('defines recent-time and hot-path partial indexes', () => {
    const sql = readFileSync(join(import.meta.dir, '../migrations/0009_jarvis_indexer_perf.sql'), 'utf8')

    expect(sql).toContain('index_jobs_ready_partial_idx')
    expect(sql).toContain('jarvis_index_documents_recent_mtime_idx')
    expect(sql).toContain('jarvis_index_chunks_embedded_doc_idx')
    expect(sql).toContain('USING BRIN')
  })

  test('defines lock fencing, chunk_count, and unique active jobs', () => {
    const sql = readFileSync(join(import.meta.dir, '../migrations/0011_jarvis_indexer_integrity.sql'), 'utf8')

    expect(sql).toContain('lock_token UUID')
    expect(sql).toContain('rerun_requested BOOLEAN')
    expect(sql).toContain('chunk_count INT')
    expect(sql).toContain('index_jobs_active_source_uidx')
  })
})

describe('indexer path jail and secrets', () => {
  test('isIgnoredPath allows keyboard.tsx and denies .env / credentials', async () => {
    const { isIgnoredPath } = await import('../src/indexer/service')
    expect(isIgnoredPath('src/components/keyboard.tsx')).toBe(false)
    expect(isIgnoredPath('src/monkey.ts')).toBe(false)
    expect(isIgnoredPath('.env')).toBe(true)
    expect(isIgnoredPath('.env.local')).toBe(true)
    expect(isIgnoredPath('secrets/id_rsa')).toBe(true)
    expect(isIgnoredPath('credentials.json')).toBe(true)
    expect(isIgnoredPath('certs/server.pem')).toBe(true)
    expect(isIgnoredPath('node_modules/pkg/index.ts')).toBe(true)
  })

  test('resolveInsideRoot rejects parent traversal and sibling prefix escapes', async () => {
    const { isPathInsideRoot, resolveInsideRoot } = await import('../src/fs/path-jail')
    const root = resolve('/tmp/workspace-root')
    expect(isPathInsideRoot(root, join(root, 'inbox', 'a.txt'))).toBe(true)
    expect(isPathInsideRoot(root, join(root, '..', 'etc', 'passwd'))).toBe(false)
    expect(isPathInsideRoot('/tmp/workspace', '/tmp/workspace-evil/x')).toBe(false)
    expect(() => resolveInsideRoot(root, '../outside.txt')).toThrow(/escapes workspace/)
    expect(resolveInsideRoot(root, 'src/app.ts')).toBe(resolve(root, 'src/app.ts'))
  })
})

describe('search filter escaping', () => {
  test('escapeLike escapes LIKE metacharacters', () => {
    // Mirrors indexerRepo helper behavior used for pathPrefix filters.
    const escapeLike = (value: string) =>
      value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')
    expect(escapeLike('src/%_test')).toBe('src/\\%\\_test')
    expect(escapeLike('foo\\bar')).toBe('foo\\\\bar')
  })
})

describe('run event index filters', () => {
  test('skips high-churn stream deltas and indexes lifecycle events', async () => {
    const { shouldIndexRunEventType } = await import('../src/indexer/service')
    expect(shouldIndexRunEventType('TEXT_MESSAGE_CONTENT')).toBe(false)
    expect(shouldIndexRunEventType('TOOL_CALL_ARGS')).toBe(false)
    expect(shouldIndexRunEventType('COWORK_STARTED')).toBe(true)
    expect(shouldIndexRunEventType('COWORK_FINISHED')).toBe(true)
    expect(shouldIndexRunEventType('RUN_STARTED')).toBe(true)
  })
})

describe('indexer hashing', () => {
  test('hashText is stable sha256 hex', async () => {
    const { hashText } = await import('../src/indexer/hashing')
    expect(hashText('hello')).toBe(hashText('hello'))
    expect(hashText('hello')).not.toBe(hashText('world'))
    expect(hashText('hello')).toMatch(/^[a-f0-9]{64}$/)
  })
})

describe('context recall budget helpers', () => {
  test('formatRecallSnippet includes linked metadata for injection', async () => {
    const { formatRecallSnippet } = await import('../src/indexer/retriever')
    const snippet = formatRecallSnippet({
      kind: 'message',
      id: 'm1',
      documentId: 'd1',
      chunkId: 'c1',
      actionId: null,
      sessionId: 's1',
      runId: 'r1',
      userId: null,
      path: null,
      title: 'user message',
      snippet: 'hello previous context',
      score: 0.9,
      lineStart: null,
      lineEnd: null,
      sourceType: 'message',
    })
    expect(snippet).toContain('[message]')
    expect(snippet).toContain('session=s1')
    expect(snippet).toContain('run=r1')
    expect(snippet).toContain('hello previous context')
  })
})

describe('indexer notify wake', () => {
  test('uses stable Postgres channel name', () => {
    expect(INDEX_JOBS_CHANNEL).toBe('jarvis_index_jobs')
  })

  test('debounces in-process wake handlers', async () => {
    let calls = 0
    const off = onIndexJobWake(() => {
      calls++
    })
    wakeIndexWorkers(10)
    wakeIndexWorkers(10)
    wakeIndexWorkers(10)
    await Bun.sleep(40)
    off()
    expect(calls).toBe(1)
  })
})
