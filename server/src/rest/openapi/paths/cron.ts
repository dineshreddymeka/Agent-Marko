import { bearerOrSession, errorResponses, jsonBody, jsonContent, ref } from '../helpers'

const cronWorkflowSchema = {
  type: 'object',
  description:
    'Enterprise workflow config. When `systemKind` is set, the scheduler runs a deterministic maintenance handler (check + auto-fix) instead of an LLM turn.',
  properties: {
    version: { type: 'integer', enum: [1] },
    intent: { type: 'string' },
    systemKind: {
      type: 'string',
      enum: ['db-consistency', 'bug-bounty'],
      description:
        'Built-in maintenance runner. `db-consistency` repairs orphans/stale bindings/stuck runs and prunes old events. `bug-bounty` runs security hygiene and auto-fixes safe issues.',
    },
    timezone: { type: 'string', default: 'UTC' },
    mcpServerIds: { type: 'array', items: { type: 'string', format: 'uuid' } },
    skillIds: { type: 'array', items: { type: 'string', format: 'uuid' } },
    profileId: { type: ['string', 'null'], format: 'uuid' },
    headlessAutoApprove: { type: 'boolean', default: false },
    retry: {
      type: 'object',
      properties: {
        maxAttempts: { type: 'integer', minimum: 1, maximum: 10 },
        backoffSec: { type: 'integer', minimum: 0, maximum: 3600 },
      },
    },
    steps: { type: 'array', items: { type: 'object', additionalProperties: true } },
    ui: { type: 'object', additionalProperties: true },
  },
}

export const cronPaths = {
  '/api/cron': {
    get: {
      tags: ['Cron'],
      summary: 'List scheduled tasks (cron jobs)',
      description:
        'Includes user jobs and built-in system maintenance jobs (DB Consistency, Bug Bounty) when seeded.',
      security: bearerOrSession,
      parameters: [
        { name: 'mcpServerId', in: 'query', schema: { type: 'string', format: 'uuid' } },
        { name: 'skillId', in: 'query', schema: { type: 'string', format: 'uuid' } },
      ],
      responses: {
        '200': jsonContent({ type: 'array', items: ref('CronJob') }),
        ...errorResponses(),
      },
    },
    post: {
      tags: ['Cron'],
      summary: 'Create scheduled task',
      security: bearerOrSession,
      requestBody: jsonBody({
        type: 'object',
        required: ['name', 'schedule', 'prompt'],
        properties: {
          name: { type: 'string' },
          schedule: {
            type: 'string',
            description: 'Cron expression. System maintenance jobs use `*/5 * * * *` (every 5 minutes).',
            example: '*/5 * * * *',
          },
          prompt: { type: 'string' },
          profileId: { type: 'string', format: 'uuid' },
          enabled: { type: 'boolean' },
          timezone: { type: 'string', default: 'UTC' },
          workflow: cronWorkflowSchema,
        },
      }),
      responses: { '201': jsonContent(ref('CronJob')), ...errorResponses() },
    },
  },
  '/api/cron/system': {
    get: {
      tags: ['Cron'],
      summary: 'List built-in system maintenance jobs',
      description: [
        'Returns the catalog and live rows for **DB Consistency** and **Bug Bounty**.',
        'Both are seeded on server boot at `*/5 * * * *` and auto-fix safe issues when they fire.',
        'Use `POST /api/cron/{id}/run` to trigger immediately.',
      ].join(' '),
      security: bearerOrSession,
      responses: {
        '200': jsonContent(ref('CronSystemJobsResponse')),
        ...errorResponses(),
      },
    },
  },
  '/api/cron/validate': {
    post: {
      tags: ['Cron'],
      summary: 'Validate cron expression',
      security: bearerOrSession,
      requestBody: jsonBody({
        type: 'object',
        properties: { schedule: { type: 'string', example: '*/5 * * * *' } },
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
          mcpServerIds: { type: 'array', items: { type: 'string', format: 'uuid' } },
          skillIds: { type: 'array', items: { type: 'string', format: 'uuid' } },
        },
      }),
      responses: { '200': jsonContent(ref('CronWizardPreviewResponse')), ...errorResponses() },
    },
  },
  '/api/cron/{id}': {
    patch: {
      tags: ['Cron'],
      summary: 'Update scheduled task',
      security: bearerOrSession,
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      requestBody: jsonBody({
        type: 'object',
        properties: {
          name: { type: 'string' },
          schedule: { type: 'string' },
          prompt: { type: 'string' },
          profileId: { type: ['string', 'null'], format: 'uuid' },
          enabled: { type: 'boolean' },
          timezone: { type: 'string' },
          workflow: cronWorkflowSchema,
        },
      }),
      responses: { '200': jsonContent(ref('CronJob')), ...errorResponses() },
    },
    delete: {
      tags: ['Cron'],
      summary: 'Delete scheduled task',
      description: 'Deleting built-in system jobs is allowed; they are re-seeded on next server boot.',
      security: bearerOrSession,
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      responses: { '200': jsonContent(ref('DeletedResponse')), ...errorResponses() },
    },
  },
  '/api/cron/{id}/runs': {
    get: {
      tags: ['Cron'],
      summary: 'List cron runs',
      description: 'For system jobs, `detail.maintenance` includes check/fix findings.',
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
      summary: 'Run scheduled task now',
      description:
        'Forces an immediate run. System maintenance jobs (`systemKind`) execute check-and-fix handlers instead of an LLM turn.',
      security: bearerOrSession,
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      responses: {
        '200': jsonContent({
          type: 'object',
          properties: { ok: { type: 'boolean' }, jobId: { type: 'string', format: 'uuid' } },
        }),
        ...errorResponses(),
      },
    },
  },
}
