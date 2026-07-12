import { bearerOrSession, errorResponses, jsonBody, jsonContent, ref } from '../helpers'

export const approvalPaths = {
  '/api/approval/config': {
    get: {
      tags: ['Approval'],
      summary: 'Get tool approval config',
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
