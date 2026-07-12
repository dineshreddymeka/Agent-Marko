import { bearerOrSession, errorResponses, jsonContent, ref } from '../helpers'

export const debugPaths = {
  '/api/debug/health': {
    get: {
      tags: ['Debug'],
      summary: 'Detailed process/health diagnostics',
      security: bearerOrSession,
      responses: { '200': jsonContent(ref('DebugHealthResponse')), ...errorResponses() },
    },
  },
  '/api/debug/runs': {
    get: {
      tags: ['Debug'],
      summary: 'Recent AG-UI runs',
      security: bearerOrSession,
      parameters: [{ name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } }],
      responses: { '200': jsonContent(ref('DebugRunsResponse')), ...errorResponses() },
    },
  },
  '/api/debug/runs/{runId}/events': {
    get: {
      tags: ['Debug'],
      summary: 'Events for a run',
      security: bearerOrSession,
      parameters: [{ name: 'runId', in: 'path', required: true, schema: { type: 'string' } }],
      responses: { '200': jsonContent(ref('DebugRunEventsResponse')), ...errorResponses() },
    },
  },
}
