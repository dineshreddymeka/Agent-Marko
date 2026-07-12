import { jsonContent, ref } from '../helpers'

const publicSecurity: [] = []

export const healthPaths = {
  '/api/health': {
    get: {
      tags: ['Health'],
      summary: 'Liveness + LLM mode',
      security: publicSecurity,
      responses: { '200': jsonContent(ref('HealthResponse')) },
    },
  },
  '/api/openapi.json': {
    get: {
      tags: ['Health'],
      summary: 'OpenAPI 3.1 document',
      security: publicSecurity,
      responses: {
        '200': {
          description: 'OpenAPI document',
          content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } },
        },
      },
    },
  },
  '/api/docs': {
    get: {
      tags: ['Health'],
      summary: 'Interactive Scalar API docs',
      security: publicSecurity,
      responses: {
        '200': {
          description: 'HTML API reference',
          content: { 'text/html': { schema: { type: 'string' } } },
        },
      },
    },
  },
}
