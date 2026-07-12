import { bearerOrSession, errorResponses, jsonBody, jsonContent, ref } from '../helpers'

export const workspacePaths = {
  '/api/workspace/tree': {
    get: {
      tags: ['Workspace'],
      summary: 'List workspace directory',
      security: bearerOrSession,
      parameters: [{ name: 'path', in: 'query', schema: { type: 'string', default: '.' } }],
      responses: { '200': jsonContent(ref('WorkspaceTreeResponse')), ...errorResponses() },
    },
  },
  '/api/workspace/git-status': {
    get: {
      tags: ['Workspace'],
      summary: 'Git porcelain status for workspace',
      security: bearerOrSession,
      responses: { '200': jsonContent(ref('WorkspaceGitStatus')), ...errorResponses() },
    },
  },
  '/api/workspace/file': {
    get: {
      tags: ['Workspace'],
      summary: 'Read workspace file',
      security: bearerOrSession,
      parameters: [{ name: 'path', in: 'query', required: true, schema: { type: 'string' } }],
      responses: { '200': jsonContent(ref('WorkspaceFileResponse')), ...errorResponses() },
    },
    put: {
      tags: ['Workspace'],
      summary: 'Write workspace file',
      security: bearerOrSession,
      requestBody: jsonBody(ref('WorkspaceFileWriteBody')),
      responses: {
        '200': jsonContent({
          type: 'object',
          properties: { ok: { type: 'boolean' }, path: { type: 'string' } },
        }),
        ...errorResponses(),
      },
    },
    delete: {
      tags: ['Workspace'],
      summary: 'Delete workspace file',
      security: bearerOrSession,
      parameters: [{ name: 'path', in: 'query', required: true, schema: { type: 'string' } }],
      responses: {
        '200': jsonContent({
          type: 'object',
          properties: { deleted: { type: 'boolean' } },
        }),
        ...errorResponses(),
      },
    },
  },
  '/api/workspace/upload': {
    post: {
      tags: ['Workspace'],
      summary: 'Upload workspace file (JSON body)',
      security: bearerOrSession,
      requestBody: jsonBody(ref('WorkspaceUploadBody')),
      responses: { '200': jsonContent(ref('WorkspaceUploadResponse')), ...errorResponses() },
    },
  },
}
