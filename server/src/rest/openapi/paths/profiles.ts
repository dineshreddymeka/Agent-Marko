import { bearerOrSession, errorResponses, jsonBody, jsonContent, ref } from '../helpers'

export const profilesPaths = {
  '/api/profiles': {
    get: {
      tags: ['Profiles'],
      summary: 'List profiles',
      security: bearerOrSession,
      responses: {
        '200': jsonContent({ type: 'array', items: ref('Profile') }),
        ...errorResponses(),
      },
    },
    post: {
      tags: ['Profiles'],
      summary: 'Create profile',
      security: bearerOrSession,
      requestBody: jsonBody({
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string' },
          systemPrompt: { type: 'string' },
          model: { type: 'string' },
          temperature: { type: 'number' },
          provider: { type: 'string', enum: ['native', 'agui-remote', 'hermes-python'] },
          providerConfig: { type: 'object', additionalProperties: true },
        },
      }),
      responses: { '201': jsonContent(ref('Profile')), ...errorResponses() },
    },
  },
  '/api/profiles/{id}': {
    get: {
      tags: ['Profiles'],
      summary: 'Get profile',
      security: bearerOrSession,
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      responses: { '200': jsonContent(ref('Profile')), ...errorResponses() },
    },
    patch: {
      tags: ['Profiles'],
      summary: 'Update profile',
      security: bearerOrSession,
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      requestBody: jsonBody({ type: 'object', additionalProperties: true }),
      responses: { '200': jsonContent(ref('Profile')), ...errorResponses() },
    },
    delete: {
      tags: ['Profiles'],
      summary: 'Delete profile',
      security: bearerOrSession,
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      responses: { '200': jsonContent(ref('DeletedResponse')), ...errorResponses() },
    },
  },
  '/api/profiles/{id}/default': {
    post: {
      tags: ['Profiles'],
      summary: 'Set default profile',
      security: bearerOrSession,
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      responses: {
        '200': jsonContent({
          type: 'object',
          properties: {
            defaultProfileId: { type: 'string' },
            profile: ref('Profile'),
          },
        }),
        ...errorResponses(),
      },
    },
  },
}
