import { mkdir } from 'node:fs/promises'
import { handleAguiCancel, handleAguiOptions, handleAguiRequest } from './agui/endpoint'
import { guardRequest, auth } from './auth'
import { isMockLlmEnabled } from './agent/mock-llm'
import { config } from './config'
import { startCronScheduler } from './cron/scheduler'
import { startCleanupWorker } from './cleanup/worker'
import { pingDatabase } from './db/client'
import { runMigrations } from './db/migrate'
import { getHealthResponse } from './health'
import { isDebugChannel, logger, newRequestId, runWithLogContextAsync } from './log'
import { connectAll } from './mcp/manager'
import { syncSkillsFromDisk } from './skills/loader'
import { refreshMcpToolBridge } from './mcp/tool-bridge'
import { handleRest } from './rest/router'
import { loadApprovalSettings } from './agent/approval'
import { hydrateWorkspaceRootFromSettings } from './workspace/root'
import { securityHeaders } from './security-headers'
import { resolveCorsOrigin } from './security/cors'
import { startIndexerWorker } from './indexer/worker'
import { startWorkspaceWatcher } from './indexer/watcher'
import { staticDistPath, tryServeStatic } from './static'

function corsHeaders(req: Request): HeadersInit {
  const origin = resolveCorsOrigin(req)
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Request-Id',
    'Access-Control-Expose-Headers': 'X-Request-Id',
    ...securityHeaders(),
  }
  if (origin) {
    headers['Access-Control-Allow-Origin'] = origin
    if (origin !== '*') headers['Access-Control-Allow-Credentials'] = 'true'
  }
  return headers
}

function withCors(req: Request, res: Response, requestId?: string): Response {
  const headers = new Headers(res.headers)
  for (const [k, v] of Object.entries(corsHeaders(req))) headers.set(k, v)
  if (requestId) headers.set('X-Request-Id', requestId)
  return new Response(res.body, { status: res.status, headers })
}

async function boot(): Promise<void> {
  await mkdir(config.WORKSPACE_ROOT, { recursive: true })
  await mkdir(config.SKILLS_DIR, { recursive: true }).catch(() => {})

  logger.info('Boot starting', {
    host: config.HOST,
    port: config.PORT,
    serveStatic: config.HERMES_SERVE_STATIC,
    publicUrl: config.HERMES_PUBLIC_URL,
    ldap: config.LDAP_ENABLED,
    llm: {
      mode: isMockLlmEnabled() ? 'mock' : 'live',
      baseUrl: config.LLM_BASE_URL,
      mockEnv: process.env.HERMES_MOCK_LLM ?? '(unset)',
    },
    logLevel: config.LOG_LEVEL,
    debug: {
      llm: isDebugChannel('llm'),
      agui: isDebugChannel('agui'),
      http: isDebugChannel('http'),
      db: isDebugChannel('db'),
      mcp: isDebugChannel('mcp'),
      tools: isDebugChannel('tools'),
    },
  })

  if (!(await pingDatabase())) {
    logger.warn('Database unavailable — start Postgres with `bun run db:up`')
    return
  }

  await runMigrations()
  const { verifyAuthTables } = await import('./db/auth-db')
  const authDb = await verifyAuthTables()
  if (!authDb.ok) {
    logger.warn('Auth database tables missing — run `bun run migrate` (0015_auth.sql)', {
      missing: authDb.missing,
    })
  } else if (config.LDAP_ENABLED) {
    logger.info('Auth database ready for LDAP', { tables: authDb.tables })
  }
  await hydrateWorkspaceRootFromSettings()
  await loadApprovalSettings(config.AUTO_APPROVE_ALL)
  const { ensureAutoApproveAllEnabled } = await import('./agent/approval')
  if (config.AUTO_APPROVE_ALL) await ensureAutoApproveAllEnabled()
  await syncSkillsFromDisk()
  await startIndexerWorker()
  startWorkspaceWatcher()
  await startCronScheduler()
  if (config.CLEANUP_ENABLED) startCleanupWorker()
  await connectAll()
  await refreshMcpToolBridge()
  try {
    const { refreshCapabilityManifest } = await import('./capabilities')
    const { resolveAgentLlmRoute } = await import('./capabilities/health')
    const manifest = await refreshCapabilityManifest('boot')
    const agentRoute = await resolveAgentLlmRoute()
    logger.info('Capability manifest warmed', {
      tools: manifest.tools.length,
      skills: manifest.skills.length,
      plugins: manifest.plugins.length,
      routing: manifest.routing,
      agentLlm: {
        toolsEnabled: agentRoute.toolsEnabled,
        degraded: agentRoute.degraded,
        reason: agentRoute.reason,
        baseUrl: agentRoute.baseUrl,
      },
    })
    if (agentRoute.degraded) {
      logger.warn(
        'Agent tools degraded — set HERMES_AGENT_LLM_URL to a tool-capable OpenAI-compatible endpoint (not lm-bridge :3456 alone)',
      )
    }
  } catch (err) {
    logger.warn('Capability manifest warm failed', { error: String(err) })
  }
  logger.info('Boot complete')
}

await boot()

const server = Bun.serve({
  hostname: config.HOST,
  port: config.PORT,
  async fetch(req, bunServer) {
    const requestId = req.headers.get('X-Request-Id') ?? newRequestId()
    const url = new URL(req.url)
    const started = performance.now()

    return runWithLogContextAsync({ requestId, method: req.method, path: url.pathname }, async () => {
      if (req.method === 'OPTIONS') {
        return withCors(req, new Response(null, { status: 204 }), requestId)
      }

      try {
        if (isDebugChannel('http') && url.pathname !== '/api/health') {
          logger.debug('HTTP request', {
            method: req.method,
            path: url.pathname,
            query: url.search || undefined,
            contentType: req.headers.get('content-type') ?? undefined,
          })
        }

        let res: Response

        if (url.pathname === '/agui' && req.method === 'OPTIONS') {
          res = handleAguiOptions()
        } else if (url.pathname === '/agui' && req.method === 'POST') {
          // AG-UI SSE can sit quiet during lm-bridge thinking/tool rounds; Bun default idleTimeout is 10s.
          bunServer.timeout(req, 0)
          const denied = await guardRequest(req)
          if (denied) res = denied
          else res = await handleAguiRequest(req)
        } else if (url.pathname.startsWith('/agui/') && req.method === 'DELETE') {
          const denied = await guardRequest(req)
          if (denied) res = denied
          else {
            const runId = url.pathname.split('/').pop()!
            res = await handleAguiCancel(req, runId)
          }
        } else if (url.pathname.startsWith('/api/auth')) {
          res = await auth.handler(req)
        } else if (url.pathname === '/api/health' && req.method === 'GET') {
          res = Response.json(await getHealthResponse())
        } else if (config.HERMES_SERVE_STATIC) {
          const staticRes = await tryServeStatic(req)
          if (staticRes) res = staticRes
          else {
            const denied = await guardRequest(req)
            if (denied) res = denied
            else res = await handleRest(req)
          }
        } else {
          const denied = await guardRequest(req)
          if (denied) res = denied
          else res = await handleRest(req)
        }

        const durationMs = Math.round(performance.now() - started)
        if (isDebugChannel('http') && url.pathname !== '/api/health') {
          logger.debug('HTTP response', {
            method: req.method,
            path: url.pathname,
            status: res.status,
            durationMs,
          })
        } else if (res.status >= 400) {
          logger.warn('HTTP error response', {
            method: req.method,
            path: url.pathname,
            status: res.status,
            durationMs,
          })
        }

        return withCors(req, res, requestId)
      } catch (err) {
        const durationMs = Math.round(performance.now() - started)
        logger.error('Request failed', {
          error: err,
          method: req.method,
          path: url.pathname,
          durationMs,
        })
        return withCors(
          req,
          Response.json(
            { error: String(err), requestId, code: 'INTERNAL_ERROR' },
            { status: 500 },
          ),
          requestId,
        )
      }
    })
  },
})

logger.info(`Open Jarvis server listening on http://${config.HOST}:${config.PORT}`, {
  logLevel: config.LOG_LEVEL,
  serveStatic: config.HERMES_SERVE_STATIC,
  staticRoot: config.HERMES_SERVE_STATIC ? staticDistPath() : undefined,
})

export default server
