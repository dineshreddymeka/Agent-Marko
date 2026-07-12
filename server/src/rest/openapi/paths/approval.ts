import { bearerOrSession, errorResponses, jsonBody, jsonContent, ref } from '../helpers'

export const approvalPaths = {
  '/api/approval/config': {
    get: {
      tags: ['Approval'],
      summary: 'Get tool approval config',
      description:
        'Auto-approve is locked ON (never off). Status Auto-Approve cron re-asserts every 5 minutes.',
      security: bearerOrSession,
      responses: { '200': jsonContent(ref('ApprovalConfig')), ...errorResponses() },
    },
    put: {
      tags: ['Approval'],
      summary: 'Update tool approval config',
      security: bearerOrSession,
      requestBody: jsonBody(ref('UpdateApprovalConfigBody')),
      responses: { '200': jsonContent(ref('ApprovalConfig')), ...errorResponses() },
    },
  },
  '/api/approval/pending': {
    get: {
      tags: ['Approval'],
      summary: 'List pending HITL tool approvals',
      description:
        'In-memory approvals waiting for resolve. The Status Auto-Approve cron (`*/5 * * * *`) auto-approves these.',
      security: bearerOrSession,
      responses: {
        '200': jsonContent({
          type: 'object',
          properties: {
            pending: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  toolCallId: { type: 'string' },
                  sessionId: { type: 'string' },
                  runId: { type: 'string' },
                  toolName: { type: 'string' },
                },
                required: ['toolCallId', 'sessionId', 'runId', 'toolName'],
              },
            },
          },
          required: ['pending'],
        }),
        ...errorResponses(),
      },
    },
  },
  '/api/approval/auto-approve-pending': {
    post: {
      tags: ['Approval'],
      summary: 'Enable autoApproveAll and approve all pending now',
      description: 'Same action the Status Auto-Approve system cron performs every 5 minutes.',
      security: bearerOrSession,
      responses: {
        '200': jsonContent({
          type: 'object',
          properties: {
            ok: { type: 'boolean' },
            approved: { type: 'integer' },
            config: { $ref: '#/components/schemas/ApprovalConfig' },
          },
          required: ['ok', 'approved', 'config'],
        }),
        ...errorResponses(),
      },
    },
  },
  '/api/approval/resolve': {
    post: {
      tags: ['Approval'],
      summary: 'Resolve pending tool approval',
      security: bearerOrSession,
      requestBody: jsonBody(ref('ResolveApprovalBody')),
      responses: {
        '200': jsonContent(ref('ResolveApprovalResponse')),
        ...errorResponses(),
      },
    },
  },
}
