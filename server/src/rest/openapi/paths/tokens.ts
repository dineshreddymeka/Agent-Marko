import { bearerOrSession, errorResponses, jsonBody, jsonContent, ref } from '../helpers'

export const tokensPaths = {
  '/api/tokens': {
    get: {
      tags: ['API Tokens'],
      summary: 'List API tokens',
      description: 'Also mounted at `/api/settings/tokens`.',
      security: bearerOrSession,
      responses: { '200': jsonContent(ref('ApiTokenListResponse')), ...errorResponses() },
    },
    post: {
      tags: ['API Tokens'],
      summary: 'Create API token',
      security: bearerOrSession,
      requestBody: jsonBody({
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string' },
          scopes: { type: 'array', items: { type: 'string' } },
        },
      }),
      responses: { '201': jsonContent(ref('ApiToken')), ...errorResponses() },
    },
  },
  '/api/tokens/{id}': {
    delete: {
      tags: ['API Tokens'],
      summary: 'Delete API token',
      security: bearerOrSession,
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      responses: { '200': jsonContent(ref('DeletedResponse')), ...errorResponses() },
    },
  },
  '/api/settings/tokens': {
    get: {
      tags: ['API Tokens'],
      summary: 'List API tokens (settings alias)',
      security: bearerOrSession,
      responses: { '200': jsonContent(ref('ApiTokenListResponse')), ...errorResponses() },
    },
  },
}
