import { bearerOrSession, errorResponses, jsonBody, jsonContent, ref } from '../helpers'

export const coworkPaths = {
  '/api/cowork/setup': {
    get: {
      tags: ['Cowork'],
      summary: 'Open Cowork exe/workspace readiness',
      security: bearerOrSession,
      responses: { '200': jsonContent(ref('CoworkSetupResponse')), ...errorResponses() },
    },
    put: {
      tags: ['Cowork'],
      summary: 'Persist Cowork exe/workspace overrides',
      security: bearerOrSession,
      requestBody: jsonBody({
        type: 'object',
        properties: {
          exe: { type: 'string' },
          workspace: { type: 'string' },
        },
      }),
      responses: { '200': jsonContent(ref('CoworkSetupResponse')), ...errorResponses() },
    },
  },
  '/api/cowork/tasks': {
    get: {
      tags: ['Cowork'],
      summary: 'List Cowork tasks',
      security: bearerOrSession,
      responses: { '200': jsonContent(ref('CoworkTaskListResponse')), ...errorResponses() },
    },
    post: {
      tags: ['Cowork'],
      summary: 'Create Cowork task',
      security: bearerOrSession,
      requestBody: jsonBody(ref('CreateCoworkTaskBody')),
      responses: {
        '202': jsonContent(ref('CreateCoworkTaskResponse'), 'Accepted — task started asynchronously'),
        '503': jsonContent(ref('ApiError'), 'Cowork exe missing'),
        ...errorResponses(),
      },
    },
  },
  '/api/cowork/tasks/{taskId}': {
    get: {
      tags: ['Cowork'],
      summary: 'Get Cowork task detail',
      security: bearerOrSession,
      parameters: [{ name: 'taskId', in: 'path', required: true, schema: { type: 'string' } }],
      responses: { '200': jsonContent(ref('CoworkTaskDetail')), ...errorResponses() },
    },
  },
  '/api/cowork/tasks/{taskId}/abort': {
    post: {
      tags: ['Cowork'],
      summary: 'Abort Cowork task',
      security: bearerOrSession,
      parameters: [{ name: 'taskId', in: 'path', required: true, schema: { type: 'string' } }],
      responses: { '200': jsonContent(ref('AbortCoworkTaskResponse')), ...errorResponses() },
    },
  },
  '/api/cowork/mcp-bridge/register': {
    post: {
      tags: ['Cowork'],
      summary: 'Register the Jarvis MCP bridge in Open Cowork mcp-config.json',
      security: bearerOrSession,
      responses: {
        '200': jsonContent({
          type: 'object',
          properties: {
            ok: { type: 'boolean' },
            mcpBridge: {
              type: 'object',
              properties: {
                registered: { type: 'boolean' },
                command: { type: 'string' },
                configPath: { type: 'string' },
                hint: { type: 'string' },
              },
            },
          },
        }),
        ...errorResponses(),
      },
    },
  },
}
