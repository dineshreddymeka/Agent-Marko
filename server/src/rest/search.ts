import { jsonResponse } from './helpers'
import type { IndexSourceType } from '../db/repositories/indexer'
import type { SearchResult } from '../vector/search'

const INDEX_SOURCE_TYPES = new Set<IndexSourceType>([
  'workspace_file',
  'message',
  'memory',
  'skill',
  'session',
  'cron_job',
  'run_event',
  'cowork_task',
  'office_artifact',
])

function csv(value: string | null): string[] {
  return value
    ? value
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean)
    : []
}

function dateParam(value: string | null): Date | undefined {
  if (!value) return undefined
  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? undefined : date
}

function resultKey(item: Pick<SearchResult, 'kind' | 'id'>): string {
  return `${item.kind}:${item.id}`
}

export async function handleSearch(req: Request, path: string): Promise<Response | null> {
  const parts = path.split('/').filter(Boolean)
  if (req.method !== 'GET' || parts.length !== 2) return null

  const url = new URL(req.url)
  const q = url.searchParams.get('q')
  if (!q) return jsonResponse({ error: 'q required' }, 400)
  const type = url.searchParams.get('type') // memory | skill | message | session | workspace_file | null=all
  const topK = Math.max(1, Math.min(Number(url.searchParams.get('topK') ?? '20') || 20, 100))

  const { hybridSearch } = await import('../vector/search')
  let results = await hybridSearch(q, topK)

  if (type === 'session' || !type) {
    try {
      const { sessionsRepo } = await import('../db/repositories/sessions')
      const sessions = await sessionsRepo.search(q, 10)
      for (const s of sessions) {
        results.push({
          kind: 'session',
          id: s.id,
          snippet: s.title,
          sessionId: s.id,
        })
      }
    } catch {
      // DB may be unavailable
    }
  }

  try {
    const sourceTypes = csv(url.searchParams.get('sourceTypes'))
      .concat(type ? [type] : [])
      .map((value) => (value === 'file' ? 'workspace_file' : value))
      .filter((value, index, all) => all.indexOf(value) === index)
      .filter((value): value is IndexSourceType => INDEX_SOURCE_TYPES.has(value as IndexSourceType))
    const { searchRecallIndex } = await import('../indexer/retriever')
    const recall = await searchRecallIndex({
      query: q,
      topK,
      sourceTypes: sourceTypes.length ? sourceTypes : undefined,
      pathPrefix: url.searchParams.get('pathPrefix') ?? undefined,
      extension: url.searchParams.get('extension') ?? undefined,
      sessionId: url.searchParams.get('sessionId') ?? undefined,
      runId: url.searchParams.get('runId') ?? undefined,
      userId: url.searchParams.get('userId') ?? undefined,
      actionId: url.searchParams.get('actionId') ?? undefined,
      from: dateParam(url.searchParams.get('from')),
      to: dateParam(url.searchParams.get('to')),
      tags: csv(url.searchParams.get('tags')),
      includeDeleted: url.searchParams.get('includeDeleted') === 'true',
    })
    const recallResults: SearchResult[] = recall.map((item) => ({
      kind: item.kind,
      id: item.id,
      snippet: item.snippet,
      score: item.score,
      sessionId: item.sessionId ?? undefined,
      runId: item.runId,
      userId: item.userId,
      actionId: item.actionId,
      documentId: item.documentId,
      chunkId: item.chunkId,
      path: item.path,
      title: item.title,
      lineStart: item.lineStart,
      lineEnd: item.lineEnd,
      sourceType: item.sourceType,
    }))
    const recallKeys = new Set(recallResults.map(resultKey))
    results = results.filter((item) => !recallKeys.has(resultKey(item)))
    results.push(...recallResults)
  } catch {
    // Recall index is additive; legacy search should continue to work while migrations/local embeddings recover.
  }

  if (type) {
    results = results.filter((r) => r.kind === type)
  }

  return jsonResponse({ query: q, results: results.slice(0, topK) })
}
