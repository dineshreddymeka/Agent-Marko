import { bearerOrSession, errorResponses, jsonBody, jsonContent, ref } from '../helpers'

export const mcpPaths = {
  '/api/mcp': {
    get: {
      tags: ['MCP'],
      summary: 'List MCP servers + connection states',
      description: 'Also mounted at `/api/settings/mcp` (alias).',
      security: bearerOrSession,
      responses: { '200': jsonContent(ref('McpListResponse')), ...errorResponses() },
    },
    post: {
      tags: ['MCP'],
      summary: 'Create MCP server',
      security: bearerOrSession,
      requestBody: jsonBody({
        type: 'object',
        required: ['name', 'transport'],
        properties: {
          name: { type: 'string' },
          transport: { type: 'string', enum: ['stdio', 'http'] },
          description: { type: 'string' },
          command: { type: 'string' },
          url: { type: 'string' },
          env: { type: 'object', additionalProperties: { type: 'string' } },
          headers: { type: 'object', additionalProperties: { type: 'string' } },
          enabled: { type: 'boolean' },
          toolWhitelist: { type: 'array', items: { type: 'string' } },
          httpPreferSse: { type: 'boolean' },
          timeoutMs: { type: 'integer' },
          autoReconnect: { type: 'boolean' },
          metadata: { type: 'object', additionalProperties: true },
        },
      }),
      responses: {
        '201': jsonContent(ref('McpServer')),
        '409': jsonContent(ref('ApiError')),
        ...errorResponses(),
      },
    },
  },
  '/api/mcp/prompts': {
    get: {
      tags: ['MCP'],
      summary: 'Discovered MCP prompts',
      security: bearerOrSession,
      responses: {
        '200': jsonContent({
          type: 'object',
          properties: { prompts: { type: 'array', items: { type: 'object' } } },
        }),
        ...errorResponses(),
      },
    },
  },
  '/api/mcp/resources': {
    get: {
      tags: ['MCP'],
      summary: 'Discovered MCP resources',
      security: bearerOrSession,
      responses: {
        '200': jsonContent({
          type: 'object',
          properties: { resources: { type: 'array', items: { type: 'object' } } },
        }),
        ...errorResponses(),
      },
    },
  },
  '/api/mcp/{id}': {
    patch: {
      tags: ['MCP'],
      summary: 'Update MCP server',
      security: bearerOrSession,
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      requestBody: jsonBody({ type: 'object', additionalProperties: true }),
      responses: { '200': jsonContent(ref('McpServer')), ...errorResponses() },
    },
    delete: {
      tags: ['MCP'],
      summary: 'Delete MCP server',
      security: bearerOrSession,
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      responses: { '200': jsonContent(ref('DeletedResponse')), ...errorResponses() },
    },
  },
  '/api/mcp/{id}/events': {
    get: {
      tags: ['MCP'],
      summary: 'MCP connection event history',
      security: bearerOrSession,
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      responses: {
        '200': jsonContent({
          type: 'object',
          properties: {
            events: { type: 'array', items: ref('McpConnectionEvent') },
          },
        }),
        ...errorResponses(),
      },
    },
  },
  '/api/mcp/{id}/test': {
    post: {
      tags: ['MCP'],
      summary: 'Connect/test MCP server',
      security: bearerOrSession,
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      responses: {
        '200': jsonContent({
          type: 'object',
          properties: {
            state: { type: 'object', additionalProperties: true },
            server: ref('McpServer'),
          },
        }),
        ...errorResponses(),
      },
    },
  },
  '/api/settings/mcp': {
    get: {
      tags: ['MCP'],
      summary: 'List MCP servers (settings alias)',
      security: bearerOrSession,
      responses: { '200': jsonContent(ref('McpListResponse')), ...errorResponses() },
    },
  },
}
