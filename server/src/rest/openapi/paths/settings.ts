import { bearerOrSession, errorResponses, jsonBody, jsonContent, ref } from '../helpers'

export const settingsPaths = {
  '/api/settings': {
    get: {
      tags: ['Settings'],
      summary: 'Get settings map (sensitive values masked)',
      security: bearerOrSession,
      responses: { '200': jsonContent(ref('SettingsMap')), ...errorResponses() },
    },
    put: {
      tags: ['Settings'],
      summary: 'Update settings',
      security: bearerOrSession,
      requestBody: jsonBody(ref('SettingsMap')),
      responses: { '200': jsonContent(ref('SettingsMap')), ...errorResponses() },
    },
  },
  '/api/settings/export': {
    get: {
      tags: ['Settings'],
      summary: 'Export sessions/memory/skills/profiles/settings',
      security: bearerOrSession,
      responses: { '200': jsonContent(ref('SettingsExportResponse')), ...errorResponses() },
    },
  },
}
