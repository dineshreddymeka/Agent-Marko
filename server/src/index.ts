import { mkdir } from 'node:fs/promises'
import { handleAguiCancel, handleAguiOptions, handleAguiRequest } from './agui/endpoint'
import { guardRequest, auth } from './auth'
import { config } from './config'
import { startCronScheduler } from './cron/scheduler'
import { startCleanupWorker } from './cleanup/worker'
import { pingDatabase } from './db/client'
import { runMigrations } from './db/migrate'
import { getHealthResponse } from './health'
import { logger } from './log'
import { connectAll } from './mcp/manager'
import { syncSkillsFromDisk } from './skills/loader'
import { refreshMcpToolBridge } from './mcp/tool-bridge'
import { handleRest } from './rest/router'
import { loadApprovalSettings } from './agent/approval'

function corsHeaders(req: Request): HeadersInit {
  const origin = req.headers.get('Origin') ?? '*'
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Credentials': 'true',
  }
}

function withCors(req: Request, res: Response): Response {
  const headers = new Headers(res.headers)
  for (const [k, v] of Object.entries(corsHeaders(req))) headers.set(k, v)
  return new Response(res.body, { status: res.status, headers })
}

async function boot(): Promise<void> {
  await mkdir(config.WORKSPACE_ROOT, { recursive: true })
  await mkdir(config.SKILLS_DIR, { recursive: true }).catch(() => {})

  if (!(await pingDatabase())) {
    logger.warn('Database unavailable — start Postgres with `bun run db:up`')
    return
  }

  await runMigrations()
  await loadApprovalSettings(config.AUTO_APPROVE_ALL)
  await syncSkillsFromDisk()
  await startCronScheduler()
  if (config.CLEANUP_ENABLED) startCleanupWorker()
  await connectAll()
  await refreshMcpToolBridge()
  logger.info('Boot complete')
}

await boot()

const server = Bun.serve({
  hostname: config.HOST,
  port: config.PORT,
  async fetch(req) {
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(req) })
    }

    const url = new URL(req.url)

    try {
      if (url.pathname === '/agui' && req.method === 'OPTIONS') {
        return withCors(req, handleAguiOptions())
      }
      if (url.pathname === '/agui' && req.method === 'POST') {
        const denied = await guardRequest(req)
        if (denied) return withCors(req, denied)
        return withCors(req, await handleAguiRequest(req))
      }
      if (url.pathname.startsWith('/agui/') && req.method === 'DELETE') {
        const runId = url.pathname.split('/').pop()!
        return withCors(req, await handleAguiCancel(req, runId))
      }

      if (url.pathname.startsWith('/api/auth')) {
        return withCors(req, await auth.handler(req))
      }

      if (url.pathname === '/api/health' && req.method === 'GET') {
        return withCors(req, Response.json(await getHealthResponse()))
      }

      const denied = await guardRequest(req)
      if (denied) return withCors(req, denied)

      return withCors(req, await handleRest(req))
    } catch (err) {
      logger.error('Request failed', { error: String(err), path: url.pathname })
      return withCors(req, Response.json({ error: String(err) }, { status: 500 }))
    }
  },
})

logger.info(`Hermes server listening on http://${config.HOST}:${config.PORT}`)

export default server
