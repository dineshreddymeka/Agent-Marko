import { bearerOrSession, errorResponses, jsonBody, jsonContent, ref } from '../helpers'

export const skillsPaths = {
  '/api/skills': {
    get: {
      tags: ['Skills'],
      summary: 'List skills',
      security: bearerOrSession,
      responses: {
        '200': jsonContent({ type: 'array', items: ref('Skill') }),
        ...errorResponses(),
      },
    },
    post: {
      tags: ['Skills'],
      summary: 'Create skill',
      security: bearerOrSession,
      requestBody: jsonBody({
        type: 'object',
        required: ['name', 'bodyMd'],
        properties: {
          name: { type: 'string' },
          bodyMd: { type: 'string' },
          description: { type: 'string' },
          source: { type: 'string' },
          triggers: { type: 'array', items: { type: 'string' } },
          enabled: { type: 'boolean' },
          writeDisk: { type: 'boolean' },
        },
      }),
      responses: {
        '201': jsonContent(ref('Skill')),
        ...errorResponses(),
      },
    },
  },
  '/api/skills/meta': {
    get: {
      tags: ['Skills'],
      summary: 'Skills panel meta',
      security: bearerOrSession,
      responses: { '200': jsonContent(ref('SkillsMeta')), ...errorResponses() },
    },
  },
  '/api/skills/sync': {
    post: {
      tags: ['Skills'],
      summary: 'Sync skills from disk / git sources',
      security: bearerOrSession,
      responses: { '200': jsonContent(ref('SkillsSyncResult')), ...errorResponses() },
    },
  },
  '/api/skills/sources': {
    get: {
      tags: ['Skills'],
      summary: 'List git skill sources',
      security: bearerOrSession,
      responses: { '200': jsonContent(ref('SkillsSourcesResponse')), ...errorResponses() },
    },
    post: {
      tags: ['Skills'],
      summary: 'Add git skill source',
      security: bearerOrSession,
      requestBody: jsonBody({
        type: 'object',
        required: ['url'],
        properties: { url: { type: 'string' } },
      }),
      responses: { '200': jsonContent(ref('SkillsSourcesResponse')), ...errorResponses() },
    },
  },
  '/api/skills/sources/{url}': {
    delete: {
      tags: ['Skills'],
      summary: 'Remove git skill source',
      security: bearerOrSession,
      parameters: [{ name: 'url', in: 'path', required: true, schema: { type: 'string' } }],
      responses: { '200': jsonContent(ref('SkillsSourcesResponse')), ...errorResponses() },
    },
  },
  '/api/skills/{id}': {
    get: {
      tags: ['Skills'],
      summary: 'Get skill',
      security: bearerOrSession,
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      responses: { '200': jsonContent(ref('Skill')), ...errorResponses() },
    },
    patch: {
      tags: ['Skills'],
      summary: 'Update skill',
      security: bearerOrSession,
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      requestBody: jsonBody({ type: 'object', additionalProperties: true }),
      responses: { '200': jsonContent(ref('Skill')), ...errorResponses() },
    },
    delete: {
      tags: ['Skills'],
      summary: 'Delete skill',
      security: bearerOrSession,
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      responses: { '200': jsonContent(ref('DeletedResponse')), ...errorResponses() },
    },
  },
  '/api/skills/{id}/recreate': {
    post: {
      tags: ['Skills'],
      summary: 'Recreate missing skill on disk',
      security: bearerOrSession,
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      responses: {
        '200': jsonContent({
          type: 'object',
          properties: {
            skill: ref('Skill'),
            path: { type: 'string' },
          },
        }),
        ...errorResponses(),
      },
    },
  },
}
