import { handleSessions } from './sessions'
import { handleMessages } from './messages'
import { handleSkills } from './skills'
import { handleMemory } from './memory'
import { handleCron } from './cron'
import { handleCowork } from './cowork'
import { handleProfiles } from './profiles'
import { handleSettings } from './settings'
import { handleWorkspace } from './workspace'
import { handleSearch } from './search'
import { handleMcp } from './mcp'
import { handleDebug } from './debug'
import { handleApproval } from './approval'
import { handleApiTokens } from './tokens'
import { handleOffice } from './office'
import { handleIndexer } from './indexer'
import { handleOpenApiDocs } from './openapi/serve'
import { jsonResponse } from './helpers'
import { isHermesError } from '../errors'

type Handler = (req: Request, path: string) => Promise<Response | null>

const handlers: Array<{ prefix: string; handler: Handler }> = [
  { prefix: '/api/sessions', handler: handleSessions },
  { prefix: '/api/messages', handler: handleMessages },
  { prefix: '/api/skills', handler: handleSkills },
  { prefix: '/api/memory', handler: handleMemory },
  { prefix: '/api/cron', handler: handleCron },
  { prefix: '/api/cowork', handler: handleCowork },
  { prefix: '/api/profiles', handler: handleProfiles },
  { prefix: '/api/settings', handler: handleSettings },
  { prefix: '/api/workspace', handler: handleWorkspace },
  { prefix: '/api/search', handler: handleSearch },
  { prefix: '/api/mcp', handler: handleMcp },
  { prefix: '/api/tokens', handler: handleApiTokens },
  { prefix: '/api/office', handler: handleOffice },
  { prefix: '/api/indexer', handler: handleIndexer },
  { prefix: '/api/debug', handler: handleDebug },
  { prefix: '/api/approval', handler: handleApproval },
]

export async function handleRest(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const path = url.pathname

  const docs = await handleOpenApiDocs(req)
  if (docs) return docs

  if (path === '/api/health' && req.method === 'GET') {
    return jsonResponse({ ok: true, service: 'hermes-server' })
  }

  if (path.startsWith('/api/settings/tokens')) {
    try {
      const res = await handleApiTokens(req, path)
      if (res) return res
    } catch (err) {
      if (isHermesError(err)) return jsonResponse(err.toJSON(), err.status)
      return jsonResponse({ error: String(err) }, 500)
    }
  }

  // W2/W4 contract: MCP also mounted under /api/settings/mcp
  if (path.startsWith('/api/settings/mcp')) {
    try {
      const rewritten = path.replace('/api/settings/mcp', '/api/mcp')
      const res = await handleMcp(req, rewritten)
      if (res) return res
    } catch (err) {
      if (isHermesError(err)) return jsonResponse(err.toJSON(), err.status)
      return jsonResponse({ error: String(err) }, 500)
    }
  }

  for (const { prefix, handler } of handlers) {
    if (path.startsWith(prefix)) {
      try {
        const res = await handler(req, path)
        if (res) return res
      } catch (err) {
        if (isHermesError(err)) {
          return jsonResponse(err.toJSON(), err.status)
        }
        return jsonResponse({ error: String(err) }, 500)
      }
    }
  }

  if (path.match(/^\/api\/sessions\/[^/]+\/messages/)) {
    try {
      const res = await handleMessages(req, path)
      if (res) return res
    } catch (err) {
      return jsonResponse({ error: String(err) }, 500)
    }
  }

  return jsonResponse({ error: 'Not found' }, 404)
}
