import { bearerOrSession, errorResponses, jsonBody, jsonContent, ref } from '../helpers'

const publicSecurity: [] = []

export const officePaths = {
  '/api/office/config': {
    get: {
      tags: ['Office/Briefing'],
      summary: 'Microsoft Graph OAuth config (no secrets)',
      security: publicSecurity,
      responses: { '200': jsonContent(ref('OfficeConfigResponse')) },
    },
  },
  '/api/office/status': {
    get: {
      tags: ['Office/Briefing'],
      summary: 'Connection status + granted scopes',
      security: bearerOrSession,
      responses: { '200': jsonContent(ref('OfficeStatusResponse')), ...errorResponses() },
    },
  },
  '/api/office/sso': {
    get: {
      tags: ['Office/Briefing'],
      summary: 'Redirect into Microsoft SSO',
      security: publicSecurity,
      parameters: [{ name: 'returnTo', in: 'query', schema: { type: 'string' } }],
      responses: {
        '302': { description: 'Redirect to Microsoft authorize URL' },
        '400': jsonContent(ref('ApiError')),
      },
    },
  },
  '/api/office/connect': {
    get: {
      tags: ['Office/Briefing'],
      summary: 'Start OAuth connect (redirect)',
      security: bearerOrSession,
      parameters: [
        { name: 'returnTo', in: 'query', schema: { type: 'string' } },
        { name: 'prompt', in: 'query', schema: { type: 'string' } },
        { name: 'artifacts', in: 'query', schema: { type: 'string' } },
      ],
      responses: {
        '302': { description: 'Redirect to Microsoft authorize URL' },
        ...errorResponses(),
      },
    },
    post: {
      tags: ['Office/Briefing'],
      summary: 'Start OAuth connect (returns authUrl)',
      security: bearerOrSession,
      requestBody: jsonBody({
        type: 'object',
        properties: {
          returnTo: { type: 'string' },
          prompt: { type: 'string' },
          artifacts: { oneOf: [{ type: 'boolean' }, { type: 'string' }] },
        },
      }),
      responses: { '200': jsonContent(ref('OfficeConnectResponse')), ...errorResponses() },
    },
  },
  '/api/office/callback': {
    get: {
      tags: ['Office/Briefing'],
      summary: 'Microsoft OAuth callback',
      security: publicSecurity,
      parameters: [
        { name: 'code', in: 'query', schema: { type: 'string' } },
        { name: 'state', in: 'query', schema: { type: 'string' } },
        { name: 'error', in: 'query', schema: { type: 'string' } },
      ],
      responses: {
        '302': { description: 'Redirect back to UI with office result' },
      },
    },
  },
  '/api/office/disconnect': {
    post: {
      tags: ['Office/Briefing'],
      summary: 'Disconnect Microsoft account',
      security: bearerOrSession,
      responses: { '200': jsonContent(ref('OfficeDisconnectResponse')), ...errorResponses() },
    },
  },
  '/api/office/briefing': {
    get: {
      tags: ['Office/Briefing'],
      summary: 'Today live calendar briefing from Graph',
      security: bearerOrSession,
      responses: {
        '200': jsonContent(ref('OfficeBriefingResponse')),
        '401': jsonContent(ref('OfficeBriefingResponse'), 'Token refresh failed'),
        ...errorResponses(),
      },
    },
  },
}
