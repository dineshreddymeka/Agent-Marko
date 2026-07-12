/**
 * Chat tool: search the Jarvis recall index (workspace + runtime memory).
 */
import { registerTool } from './registry'
import { formatRecallSnippet, searchRecallIndex } from '../../indexer/retriever'
import type { IndexSourceType } from '../../db/repositories/indexer'
import { config } from '../../config'

const SOURCE_TYPES = new Set<IndexSourceType>([
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

function normalizeSourceType(value: string): IndexSourceType | null {
  const trimmed = value.trim()
  if (trimmed === 'file') return 'workspace_file'
  if (SOURCE_TYPES.has(trimmed as IndexSourceType)) return trimmed as IndexSourceType
  return null
}

function parseSourceTypes(raw: unknown): IndexSourceType[] | undefined {
  const values: string[] = []
  if (typeof raw === 'string' && raw.trim()) {
    values.push(...raw.split(',').map((part) => part.trim()).filter(Boolean))
  } else if (Array.isArray(raw)) {
    for (const item of raw) {
      if (typeof item === 'string' && item.trim()) values.push(item.trim())
    }
  }
  const mapped = values
    .map(normalizeSourceType)
    .filter((value): value is IndexSourceType => value != null)
  return mapped.length ? mapped : undefined
}

function parseDate(raw: unknown): Date | undefined {
  if (typeof raw !== 'string' || !raw.trim()) return undefined
  const date = new Date(raw)
  return Number.isNaN(date.valueOf()) ? undefined : date
}

registerTool({
  name: 'index_search',
  description:
    'Search the Hermes recall index for workspace files, past runs, and related notes. Prefer this before re-reading large files.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Natural-language search query.' },
      topK: {
        type: 'number',
        description: 'Max results to return (default INDEXER_DEFAULT_TOP_K).',
      },
      sourceType: {
        type: 'string',
        description: 'Optional single source type (e.g. workspace_file, run_event, file).',
      },
      sourceTypes: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional list of source types to include.',
      },
      pathPrefix: { type: 'string', description: 'Restrict to paths with this prefix.' },
      extension: { type: 'string', description: 'File extension filter, e.g. .ts or ts.' },
      sessionId: { type: 'string', description: 'Filter by session id.' },
      runId: { type: 'string', description: 'Filter by run id.' },
      userId: { type: 'string', description: 'Filter by user id.' },
      actionId: { type: 'string', description: 'Filter by action id.' },
      from: { type: 'string', description: 'ISO timestamp lower bound (mtime/updated_at).' },
      to: { type: 'string', description: 'ISO timestamp upper bound (mtime/updated_at).' },
      tags: {
        type: 'array',
        items: { type: 'string' },
        description: 'Require documents that include these tags.',
      },
      includeDeleted: {
        type: 'boolean',
        description: 'Include soft-deleted documents (default false).',
      },
    },
    required: ['query'],
  },
  async execute(args, ctx) {
    const query = String(args.query ?? '').trim()
    if (!query) throw new Error('query is required')
    const topKRaw = typeof args.topK === 'number' ? args.topK : Number(args.topK)
    const topK = Number.isFinite(topKRaw)
      ? Math.min(20, Math.max(1, Math.floor(topKRaw)))
      : config.INDEXER_DEFAULT_TOP_K

    const fromSourceType =
      typeof args.sourceType === 'string' ? normalizeSourceType(args.sourceType) : null
    const sourceTypes = [
      ...(parseSourceTypes(args.sourceTypes) ?? []),
      ...(fromSourceType ? [fromSourceType] : []),
    ].filter((value, index, all) => all.indexOf(value) === index)

    const tags = Array.isArray(args.tags)
      ? args.tags.filter((tag): tag is string => typeof tag === 'string' && tag.trim().length > 0)
      : typeof args.tags === 'string' && args.tags.trim()
        ? args.tags.split(',').map((tag) => tag.trim()).filter(Boolean)
        : undefined

    const results = await searchRecallIndex({
      query,
      topK,
      sourceTypes: sourceTypes.length ? sourceTypes : undefined,
      pathPrefix: typeof args.pathPrefix === 'string' ? args.pathPrefix : undefined,
      extension: typeof args.extension === 'string' ? args.extension : undefined,
      sessionId:
        typeof args.sessionId === 'string' && args.sessionId.trim()
          ? args.sessionId.trim()
          : ctx.sessionId,
      runId:
        typeof args.runId === 'string' && args.runId.trim() ? args.runId.trim() : ctx.runId,
      userId: typeof args.userId === 'string' && args.userId.trim() ? args.userId.trim() : undefined,
      actionId:
        typeof args.actionId === 'string' && args.actionId.trim() ? args.actionId.trim() : undefined,
      from: parseDate(args.from),
      to: parseDate(args.to),
      tags: tags?.length ? tags : undefined,
      includeDeleted: args.includeDeleted === true,
    })

    return {
      query,
      count: results.length,
      results: results.map((r) => ({
        id: r.id,
        sourceType: r.sourceType,
        path: r.path,
        title: r.title,
        snippet: r.snippet,
        score: r.score,
        sessionId: r.sessionId,
        runId: r.runId,
        actionId: r.actionId,
        line: formatRecallSnippet(r),
      })),
    }
  },
})
