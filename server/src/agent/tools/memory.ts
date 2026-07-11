import { memoryRepo } from '../../db/repositories/memory'
import { embedText } from '../../vector/embeddings'
import { queueEmbedding } from '../../vector/indexer'
import { registerTool } from './registry'

registerTool({
  name: 'memory_save',
  description: 'Save a memory entry for future recall',
  parameters: {
    type: 'object',
    properties: {
      kind: { type: 'string', enum: ['semantic', 'episodic', 'preference'] },
      content: { type: 'string' },
      importance: { type: 'number', minimum: 0, maximum: 1 },
    },
    required: ['kind', 'content'],
  },
  async execute(args, ctx) {
    const entry = await memoryRepo.create({
      kind: args.kind as 'semantic' | 'episodic' | 'preference',
      content: String(args.content),
      sourceSession: ctx.sessionId,
      importance: typeof args.importance === 'number' ? args.importance : 0.5,
    })
    queueEmbedding('memory', entry.id, String(args.content))
    return entry
  },
})

registerTool({
  name: 'memory_search',
  description: 'Search saved memories semantically',
  parameters: {
    type: 'object',
    properties: { query: { type: 'string' }, limit: { type: 'number' } },
    required: ['query'],
  },
  async execute(args) {
    const embedding = await embedText(String(args.query))
    const results = await memoryRepo.vectorSearch(embedding, Number(args.limit ?? 10))
    return results
  },
})
