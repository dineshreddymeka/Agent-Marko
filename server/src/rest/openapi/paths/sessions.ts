import { bearerOrSession, errorResponses, jsonBody, jsonContent, ref } from '../helpers'

export const sessionsPaths = {
  '/api/sessions': {
    get: {
      tags: ['Sessions'],
      summary: 'List sessions',
      security: bearerOrSession,
      responses: {
        '200': jsonContent({ type: 'array', items: ref('Session') }),
        ...errorResponses(),
      },
    },
    post: {
      tags: ['Sessions'],
      summary: 'Create session',
      security: bearerOrSession,
      requestBody: jsonBody({
        type: 'object',
        properties: {
          title: { type: 'string' },
          groupName: { type: 'string' },
          profileId: { type: 'string' },
        },
      }),
      responses: {
        '201': jsonContent(ref('Session')),
        ...errorResponses(),
      },
    },
  },
  '/api/sessions/{id}': {
    get: {
      tags: ['Sessions'],
      summary: 'Get session',
      security: bearerOrSession,
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      responses: {
        '200': jsonContent(ref('Session')),
        ...errorResponses(),
      },
    },
    patch: {
      tags: ['Sessions'],
      summary: 'Update session',
      security: bearerOrSession,
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      requestBody: jsonBody({ type: 'object', additionalProperties: true }),
      responses: {
        '200': jsonContent(ref('Session')),
        ...errorResponses(),
      },
    },
    delete: {
      tags: ['Sessions'],
      summary: 'Delete session',
      security: bearerOrSession,
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      responses: {
        '200': jsonContent(ref('DeletedResponse')),
        ...errorResponses(),
      },
    },
  },
  '/api/sessions/{id}/live': {
    get: {
      tags: ['Sessions'],
      summary: 'Active AG-UI run for session',
      security: bearerOrSession,
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      responses: {
        '200': jsonContent(ref('SessionLiveResponse')),
        ...errorResponses(),
      },
    },
  },
  '/api/sessions/{id}/messages': {
    get: {
      tags: ['Sessions'],
      summary: 'List messages for session',
      security: bearerOrSession,
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      responses: {
        '200': jsonContent({ type: 'array', items: ref('Message') }),
        ...errorResponses(),
      },
    },
  },
}
