import { bearerOrSession, errorResponses, jsonBody, jsonContent, ref } from '../helpers'

export const aguiPaths = {
  '/agui': {
    options: {
      tags: ['Chat/AG-UI'],
      summary: 'CORS preflight for AG-UI',
      security: [],
      responses: { '204': { description: 'No content' } },
    },
    post: {
      tags: ['Chat/AG-UI'],
      summary: 'Start AG-UI agent run (SSE)',
      description:
        'Streams `text/event-stream` AG-UI events. Custom Hermes events include hermes.context, hermes.title, hermes.approval.required, a2ui.message, etc. (see HermesCustomEvent schema).',
      security: bearerOrSession,
      requestBody: jsonBody(ref('AguiRunInput')),
      responses: {
        '200': {
          description: 'Server-Sent Events stream',
          content: {
            'text/event-stream': {
              schema: {
                type: 'string',
                description: 'SSE frames; data payloads are AG-UI / HermesCustomEvent JSON',
              },
            },
          },
        },
        ...errorResponses(),
      },
    },
  },
  '/agui/{runId}': {
    delete: {
      tags: ['Chat/AG-UI'],
      summary: 'Cancel AG-UI run',
      security: bearerOrSession,
      parameters: [{ name: 'runId', in: 'path', required: true, schema: { type: 'string' } }],
      responses: {
        '200': jsonContent(ref('OkResponse')),
        ...errorResponses(),
      },
    },
  },
}
