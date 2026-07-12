/**
 * Chat tool: search the Jarvis recall index (workspace + runtime memory).
 */
import { registerTool } from './registry'
import { formatRecallSnippet, searchRecallIndex } from '../../indexer/retriever'

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
        description: 'Max results to return (default 8).',
      },
      sourceType: {
        type: 'string',
        description: 'Optional source type filter (e.g. workspace_file, run_event).',
      },
    },
    required: ['query'],
  },
  async execute(args) {
    const query = String(args.query ?? '').trim()
    if (!query) throw new Error('query is required')
    const topKRaw = typeof args.topK === 'number' ? args.topK : Number(args.topK)
    const topK = Number.isFinite(topKRaw) ? Math.min(20, Math.max(1, Math.floor(topKRaw))) : 8
    const sourceType =
      typeof args.sourceType === 'string' && args.sourceType.trim()
        ? args.sourceType.trim()
        : undefined

    const results = await searchRecallIndex({
      query,
      topK,
      ...(sourceType
        ? { sourceTypes: [sourceType as import('../../db/repositories/indexer').IndexSourceType] }
        : {}),
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
        line: formatRecallSnippet(r),
      })),
    }
  },
})
