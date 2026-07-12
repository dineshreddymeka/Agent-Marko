import { bearerOrSession, errorResponses, jsonContent, ref } from '../helpers'

export const searchPaths = {
  '/api/search': {
    get: {
      tags: ['Search'],
      summary: 'Hybrid + recall search',
      security: bearerOrSession,
      parameters: [
        { name: 'q', in: 'query', required: true, schema: { type: 'string' } },
        { name: 'type', in: 'query', schema: { type: 'string' } },
        { name: 'topK', in: 'query', schema: { type: 'integer', default: 20 } },
        { name: 'sourceTypes', in: 'query', schema: { type: 'string' }, description: 'CSV' },
        { name: 'pathPrefix', in: 'query', schema: { type: 'string' } },
        { name: 'extension', in: 'query', schema: { type: 'string' } },
        { name: 'sessionId', in: 'query', schema: { type: 'string' } },
        { name: 'runId', in: 'query', schema: { type: 'string' } },
        { name: 'userId', in: 'query', schema: { type: 'string' } },
        { name: 'actionId', in: 'query', schema: { type: 'string' } },
        { name: 'from', in: 'query', schema: { type: 'string', format: 'date-time' } },
        { name: 'to', in: 'query', schema: { type: 'string', format: 'date-time' } },
        { name: 'tags', in: 'query', schema: { type: 'string' }, description: 'CSV' },
        { name: 'includeDeleted', in: 'query', schema: { type: 'string', enum: ['true', 'false'] } },
      ],
      responses: { '200': jsonContent(ref('SearchResponse')), ...errorResponses() },
    },
  },
}
