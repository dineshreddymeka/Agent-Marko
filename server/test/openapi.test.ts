import { describe, expect, test } from 'bun:test'
import { buildOpenApiDocument } from '../src/rest/openapi/document'
import { DB_TABLE_ALLOWLIST } from '../src/rest/openapi/schemas'
import { handleOpenApiDocs } from '../src/rest/openapi/serve'

/** Known method+path inventory (OpenAPI path templates). */
export const ENDPOINT_INVENTORY: Array<{ method: string; path: string }> = [
  // Chat / AG-UI
  { method: 'options', path: '/agui' },
  { method: 'post', path: '/agui' },
  { method: 'delete', path: '/agui/{runId}' },
  // Sessions
  { method: 'get', path: '/api/sessions' },
  { method: 'post', path: '/api/sessions' },
  { method: 'get', path: '/api/sessions/{id}' },
  { method: 'patch', path: '/api/sessions/{id}' },
  { method: 'delete', path: '/api/sessions/{id}' },
  { method: 'get', path: '/api/sessions/{id}/live' },
  { method: 'get', path: '/api/sessions/{id}/messages' },
  // Skills
  { method: 'get', path: '/api/skills' },
  { method: 'post', path: '/api/skills' },
  { method: 'get', path: '/api/skills/meta' },
  { method: 'post', path: '/api/skills/sync' },
  { method: 'get', path: '/api/skills/sources' },
  { method: 'post', path: '/api/skills/sources' },
  { method: 'delete', path: '/api/skills/sources/{url}' },
  { method: 'get', path: '/api/skills/{id}' },
  { method: 'patch', path: '/api/skills/{id}' },
  { method: 'delete', path: '/api/skills/{id}' },
  { method: 'post', path: '/api/skills/{id}/recreate' },
  // Memory
  { method: 'get', path: '/api/memory' },
  { method: 'post', path: '/api/memory' },
  { method: 'get', path: '/api/memory/{id}' },
  { method: 'patch', path: '/api/memory/{id}' },
  { method: 'delete', path: '/api/memory/{id}' },
  // Cron
  { method: 'get', path: '/api/cron' },
  { method: 'post', path: '/api/cron' },
  { method: 'post', path: '/api/cron/validate' },
  { method: 'post', path: '/api/cron/wizard/preview' },
  { method: 'patch', path: '/api/cron/{id}' },
  { method: 'delete', path: '/api/cron/{id}' },
  { method: 'get', path: '/api/cron/{id}/runs' },
  { method: 'post', path: '/api/cron/{id}/run' },
  // Cowork
  { method: 'get', path: '/api/cowork/setup' },
  { method: 'put', path: '/api/cowork/setup' },
  { method: 'get', path: '/api/cowork/tasks' },
  { method: 'post', path: '/api/cowork/tasks' },
  { method: 'get', path: '/api/cowork/tasks/{taskId}' },
  { method: 'post', path: '/api/cowork/tasks/{taskId}/abort' },
  { method: 'post', path: '/api/cowork/mcp-bridge/register' },
  // Office
  { method: 'get', path: '/api/office/config' },
  { method: 'get', path: '/api/office/status' },
  { method: 'get', path: '/api/office/sso' },
  { method: 'get', path: '/api/office/connect' },
  { method: 'post', path: '/api/office/connect' },
  { method: 'get', path: '/api/office/callback' },
  { method: 'post', path: '/api/office/disconnect' },
  { method: 'get', path: '/api/office/briefing' },
  // MCP
  { method: 'get', path: '/api/mcp' },
  { method: 'post', path: '/api/mcp' },
  { method: 'get', path: '/api/mcp/prompts' },
  { method: 'get', path: '/api/mcp/resources' },
  { method: 'patch', path: '/api/mcp/{id}' },
  { method: 'delete', path: '/api/mcp/{id}' },
  { method: 'get', path: '/api/mcp/{id}/events' },
  { method: 'post', path: '/api/mcp/{id}/test' },
  { method: 'get', path: '/api/settings/mcp' },
  // Tokens
  { method: 'get', path: '/api/tokens' },
  { method: 'post', path: '/api/tokens' },
  { method: 'delete', path: '/api/tokens/{id}' },
  { method: 'get', path: '/api/settings/tokens' },
  // Profiles
  { method: 'get', path: '/api/profiles' },
  { method: 'post', path: '/api/profiles' },
  { method: 'get', path: '/api/profiles/{id}' },
  { method: 'patch', path: '/api/profiles/{id}' },
  { method: 'delete', path: '/api/profiles/{id}' },
  { method: 'post', path: '/api/profiles/{id}/default' },
  // Settings
  { method: 'get', path: '/api/settings' },
  { method: 'put', path: '/api/settings' },
  { method: 'get', path: '/api/settings/export' },
  // Workspace
  { method: 'get', path: '/api/workspace/tree' },
  { method: 'get', path: '/api/workspace/git-status' },
  { method: 'get', path: '/api/workspace/file' },
  { method: 'put', path: '/api/workspace/file' },
  { method: 'delete', path: '/api/workspace/file' },
  { method: 'post', path: '/api/workspace/upload' },
  // Search / indexer
  { method: 'get', path: '/api/search' },
  { method: 'get', path: '/api/indexer/status' },
  { method: 'post', path: '/api/indexer/reindex' },
  { method: 'post', path: '/api/indexer/drain' },
  { method: 'post', path: '/api/indexer/prune' },
  // Debug
  { method: 'get', path: '/api/debug/health' },
  { method: 'get', path: '/api/debug/runs' },
  { method: 'get', path: '/api/debug/runs/{runId}/events' },
  // Approval
  { method: 'get', path: '/api/approval/config' },
  { method: 'put', path: '/api/approval/config' },
  { method: 'post', path: '/api/approval/resolve' },
  // Auth (mount + concrete login paths)
  { method: 'get', path: '/api/auth/{path}' },
  { method: 'post', path: '/api/auth/{path}' },
  { method: 'post', path: '/api/auth/sign-in/email' },
  { method: 'get', path: '/api/auth/sign-in/social' },
  { method: 'get', path: '/api/auth/get-session' },
  { method: 'post', path: '/api/auth/sign-out' },
  // Health / docs
  { method: 'get', path: '/api/health' },
  { method: 'get', path: '/api/openapi.json' },
  { method: 'get', path: '/api/docs' },
]

describe('openapi document', () => {
  test('parses as OpenAPI 3.1 with info and components', () => {
    const doc = buildOpenApiDocument()
    expect(doc.openapi).toBe('3.1.0')
    expect(doc.info.title).toContain('Open Jarvis')
    expect(doc.components.schemas.Session).toBeTruthy()
    expect(doc.components.securitySchemes.BearerToken).toBeTruthy()
    expect(doc.components.securitySchemes.SessionCookie).toBeTruthy()
  })

  test('GET /api/debug/health requires bearer or session (not public)', () => {
    const doc = buildOpenApiDocument()
    const op = (doc.paths['/api/debug/health'] as { get: { security?: unknown[] } }).get
    expect(op.security).toEqual([{ SessionCookie: [] }, { BearerToken: [] }])
    const healthOp = (doc.paths['/api/health'] as { get: { security?: unknown[] } }).get
    expect(healthOp.security).toEqual([])
    const llm = (doc.components.schemas.HealthResponse as {
      properties: { llm: { properties: Record<string, unknown>; required: string[] } }
    }).properties.llm
    expect(llm.properties.baseUrl).toBeUndefined()
    expect(llm.required).not.toContain('baseUrl')
  })

  test('every inventory method+path is present', () => {
    const doc = buildOpenApiDocument()
    const missing: string[] = []
    for (const { method, path } of ENDPOINT_INVENTORY) {
      const item = doc.paths[path as keyof typeof doc.paths] as Record<string, unknown> | undefined
      if (!item || typeof item[method] !== 'object') {
        missing.push(`${method.toUpperCase()} ${path}`)
      }
    }
    expect(missing).toEqual([])
  })

  test('every x-db-table maps to Drizzle allowlist', () => {
    const doc = buildOpenApiDocument()
    const allow = new Set<string>(DB_TABLE_ALLOWLIST)
    const bad: string[] = []
    for (const [name, schema] of Object.entries(doc.components.schemas)) {
      const table = (schema as { 'x-db-table'?: string })['x-db-table']
      if (table && !allow.has(table)) bad.push(`${name} → ${table}`)
    }
    expect(bad).toEqual([])
  })

  test('DB-backed resource schemas declare x-db-table', () => {
    const doc = buildOpenApiDocument()
    const required = [
      'Session',
      'Message',
      'MemoryEntry',
      'Skill',
      'CronJob',
      'CronRun',
      'Profile',
      'McpServer',
      'ApiToken',
      'RunEvent',
      'SettingRow',
      'JarvisIndexDocument',
      'IndexJob',
    ]
    for (const name of required) {
      const schema = doc.components.schemas[name] as { 'x-db-table'?: string }
      expect(schema?.['x-db-table']).toBeTruthy()
    }
  })

  test('GET /api/openapi.json serves document', async () => {
    const res = await handleOpenApiDocs(
      new Request('http://127.0.0.1/api/openapi.json'),
    )
    expect(res).not.toBeNull()
    expect(res!.status).toBe(200)
    const body = (await res!.json()) as { openapi: string }
    expect(body.openapi).toBe('3.1.0')
  })

  test('GET /api/docs serves HTML referencing same-origin assets', async () => {
    const res = await handleOpenApiDocs(new Request('http://127.0.0.1/api/docs'))
    expect(res).not.toBeNull()
    expect(res!.headers.get('content-type')).toContain('text/html')
    const html = await res!.text()
    expect(html).toContain('/api/docs/assets/scalar.js')
    expect(html).toContain('/api/docs/assets/init.js')
  })

  test('vendored Scalar assets exist', async () => {
    const scalar = await handleOpenApiDocs(
      new Request('http://127.0.0.1/api/docs/assets/scalar.js'),
    )
    const init = await handleOpenApiDocs(
      new Request('http://127.0.0.1/api/docs/assets/init.js'),
    )
    expect(scalar!.status).toBe(200)
    expect(init!.status).toBe(200)
    expect(scalar!.headers.get('content-type')).toContain('javascript')
  })
})
