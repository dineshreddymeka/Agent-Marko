import { bearerOrSession, errorResponses, jsonBody, jsonContent, ref } from '../helpers'

export const memoryPaths = {
  '/api/memory': {
    get: {
      tags: ['Memory'],
      summary: 'List memory entries',
      security: bearerOrSession,
      parameters: [
        {
          name: 'kind',
          in: 'query',
          schema: { type: 'string', enum: ['semantic', 'episodic', 'preference'] },
        },
      ],
      responses: {
        '200': jsonContent({ type: 'array', items: ref('MemoryEntry') }),
        ...errorResponses(),
      },
    },
    post: {
      tags: ['Memory'],
      summary: 'Create memory entry',
      security: bearerOrSession,
      requestBody: jsonBody({
        type: 'object',
        required: ['kind', 'content'],
        properties: {
          kind: { type: 'string', enum: ['semantic', 'episodic', 'preference'] },
          content: { type: 'string' },
          sourceSession: { type: 'string' },
          importance: { type: 'number' },
        },
      }),
      responses: {
        '201': jsonContent(ref('MemoryEntry')),
        ...errorResponses(),
      },
    },
  },
  '/api/memory/{id}': {
    get: {
      tags: ['Memory'],
      summary: 'Get memory entry',
      security: bearerOrSession,
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      responses: { '200': jsonContent(ref('MemoryEntry')), ...errorResponses() },
    },
    patch: {
      tags: ['Memory'],
      summary: 'Update memory entry',
      security: bearerOrSession,
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      requestBody: jsonBody({ type: 'object', additionalProperties: true }),
      responses: { '200': jsonContent(ref('MemoryEntry')), ...errorResponses() },
    },
    delete: {
      tags: ['Memory'],
      summary: 'Delete memory entry',
      security: bearerOrSession,
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      responses: { '200': jsonContent(ref('DeletedResponse')), ...errorResponses() },
    },
  },
}
