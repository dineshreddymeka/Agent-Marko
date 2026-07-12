import { bearerOrSession, errorResponses, jsonContent, ref } from '../helpers'

export const capabilitiesPaths = {
  '/api/capabilities': {
    get: {
      tags: ['Capabilities'],
      summary: 'Capability Hub manifest + agent LLM health snapshot',
      description:
        'Returns tools, skills, plugins, slashCommands, routing mode, and agentLlm telemetry. Pass `probe=1` to refresh the agent LLM health probe before responding.',
      security: bearerOrSession,
      parameters: [
        {
          name: 'probe',
          in: 'query',
          required: false,
          schema: { type: 'string', enum: ['1'] },
          description: 'When `1`, probe the preferred agent LLM endpoint before returning agentLlm.',
        },
      ],
      responses: { '200': jsonContent(ref('CapabilitiesResponse')), ...errorResponses() },
    },
    post: {
      tags: ['Capabilities'],
      summary: 'Rebuild capability manifest (no MCP reconnect)',
      security: bearerOrSession,
      responses: { '200': jsonContent(ref('CapabilitiesRefreshResponse')), ...errorResponses() },
    },
  },
  '/api/capabilities/warm': {
    post: {
      tags: ['Capabilities'],
      summary: 'Reconnect MCP, rebuild manifest, probe agent LLM',
      description:
        'Staging/ops warm path: reconnect enabled MCP servers, refresh the tool bridge, rebuild the hub manifest, and probe agent LLM health. Always returns ok=true when the HTTP handler completes; inspect mcpReconnect and agentLlm for readiness.',
      security: bearerOrSession,
      responses: { '200': jsonContent(ref('CapabilitiesWarmResponse')), ...errorResponses() },
    },
  },
}
