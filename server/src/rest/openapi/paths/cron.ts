import { bearerOrSession, errorResponses, jsonBody, jsonContent, ref } from '../helpers'

export const cronPaths = {
  '/api/cron': {
    get: {
      tags: ['Cron'],
      summary: 'List cron jobs',
      security: bearerOrSession,
      parameters: [
        { name: 'mcpServerId', in: 'query', schema: { type: 'string' } },
        { name: 'skillId', in: 'query', schema: { type: 'string' } },
      ],
      responses: {
        '200': jsonContent({ type: 'array', items: ref('CronJob') }),
        ...errorResponses(),
      },
    },
    post: {
      tags: ['Cron'],
      summary: 'Create cron job',
      security: bearerOrSession,
      requestBody: jsonBody({
        type: 'object',
        required: ['name', 'schedule', 'prompt'],
        properties: {
          name: { type: 'string' },
          schedule: { type: 'string' },
          prompt: { type: 'string' },
          profileId: { type: 'string' },
          enabled: { type: 'boolean' },
          timezone: { type: 'string' },
          workflow: { type: 'object', additionalProperties: true },
        },
      }),
      responses: { '201': jsonContent(ref('CronJob')), ...errorResponses() },
    },
  },
  '/api/cron/validate': {
    post: {
      tags: ['Cron'],
      summary: 'Validate cron expression',
      security: bearerOrSession,
      requestBody: jsonBody({
        type: 'object',
        properties: { schedule: { type: 'string' } },
      }),
      responses: { '200': jsonContent(ref('CronValidateResponse')), ...errorResponses() },
    },
  },
  '/api/cron/wizard/preview': {
    post: {
      tags: ['Cron'],
      summary: 'Wizard review preview (schedule + bindings)',
      security: bearerOrSession,
      requestBody: jsonBody({
        type: 'object',
        properties: {
          schedule: { type: 'string' },
          mcpServerIds: { type: 'array', items: { type: 'string' } },
          skillIds: { type: 'array', items: { type: 'string' } },
        },
      }),
      responses: { '200': jsonContent(ref('CronWizardPreviewResponse')), ...errorResponses() },
    },
  },
  '/api/cron/{id}': {
    patch: {
      tags: ['Cron'],
      summary: 'Update cron job',
      security: bearerOrSession,
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      requestBody: jsonBody({ type: 'object', additionalProperties: true }),
      responses: { '200': jsonContent(ref('CronJob')), ...errorResponses() },
    },
    delete: {
      tags: ['Cron'],
      summary: 'Delete cron job',
      security: bearerOrSession,
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      responses: { '200': jsonContent(ref('DeletedResponse')), ...errorResponses() },
    },
  },
  '/api/cron/{id}/runs': {
    get: {
      tags: ['Cron'],
      summary: 'List cron runs',
      security: bearerOrSession,
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      responses: {
        '200': jsonContent({ type: 'array', items: ref('CronRun') }),
        ...errorResponses(),
      },
    },
  },
  '/api/cron/{id}/run': {
    post: {
      tags: ['Cron'],
      summary: 'Run cron job now',
      security: bearerOrSession,
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      responses: {
        '200': jsonContent({
          type: 'object',
          properties: { ok: { type: 'boolean' }, jobId: { type: 'string' } },
        }),
        ...errorResponses(),
      },
    },
  },
}
