import type { IndexSourceType } from '../../db/repositories/indexer'
import { searchRecallIndex } from '../../indexer/retriever'
import { registerTool } from './registry'

const SOURCE_TYPES: IndexSourceType[] = [
  'workspace_file',
  'message',
  'memory',
  'skill',
  'session',
  'cron_job',
]

registerTool({
  name: 'index_search',
  description:
    'Search Jarvis previous context and workspace chunks using local embeddings, Postgres FTS, and filters',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string' },
      topK: { type: 'number', minimum: 1, maximum: 50 },
      sourceTypes: { type: 'array', items: { type: 'string', enum: SOURCE_TYPES } },
      pathPrefix: { type: 'string' },
      extension: { type: 'string' },
      sessionId: { type: 'string' },
      runId: { type: 'string' },
      actionId: { type: 'string' },
      tags: { type: 'array', items: { type: 'string' } },
    },
    required: ['query'],
  },
  async execute(args) {
    const rawSourceTypes = Array.isArray(args.sourceTypes) ? args.sourceTypes.map(String) : []
    const sourceTypes = rawSourceTypes.filter((value): value is IndexSourceType =>
      SOURCE_TYPES.includes(value as IndexSourceType),
    )
    return searchRecallIndex({
      query: String(args.query),
      topK: Number(args.topK ?? 10),
      sourceTypes: sourceTypes.length ? sourceTypes : undefined,
      pathPrefix: args.pathPrefix ? String(args.pathPrefix) : undefined,
      extension: args.extension ? String(args.extension) : undefined,
      sessionId: args.sessionId ? String(args.sessionId) : undefined,
      runId: args.runId ? String(args.runId) : undefined,
      actionId: args.actionId ? String(args.actionId) : undefined,
      tags: Array.isArray(args.tags) ? args.tags.map(String) : undefined,
    })
  },
})
