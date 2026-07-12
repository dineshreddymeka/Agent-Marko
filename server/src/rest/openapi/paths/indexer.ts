import { bearerOrSession, errorResponses, jsonContent, ref } from '../helpers'

export const indexerPaths = {
  '/api/indexer/status': {
    get: {
      tags: ['Indexer'],
      summary: 'Indexer queue + document stats',
      security: bearerOrSession,
      responses: { '200': jsonContent(ref('IndexerStatusResponse')), ...errorResponses() },
    },
  },
  '/api/indexer/reindex': {
    post: {
      tags: ['Indexer'],
      summary: 'Scan workspace and queue reindex',
      security: bearerOrSession,
      responses: { '200': jsonContent(ref('IndexerReindexResponse')), ...errorResponses() },
    },
  },
  '/api/indexer/drain': {
    post: {
      tags: ['Indexer'],
      summary: 'Drain pending index jobs',
      security: bearerOrSession,
      responses: { '200': jsonContent(ref('IndexerDrainResponse')), ...errorResponses() },
    },
  },
  '/api/indexer/prune': {
    post: {
      tags: ['Indexer'],
      summary: 'Prune old done/failed jobs and soft-deleted documents',
      security: bearerOrSession,
      requestBody: {
        required: false,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: { days: { type: 'integer', minimum: 1 } },
            },
          },
        },
      },
      responses: { '200': jsonContent(ref('IndexerPruneResponse')), ...errorResponses() },
    },
  },
}
