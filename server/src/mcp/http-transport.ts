import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { isDebugChannel, logger } from '../log'

const log = logger.child({ component: 'mcp-http' })

export type HttpTransportKind = 'streamable-http' | 'sse'

export type CreateHttpTransportOptions = {
  url: string
  headers?: Record<string, string> | null
  /** Prefer SSE first (legacy servers). Default: try streamable HTTP, then SSE. */
  preferSse?: boolean
  fetch?: typeof fetch
}

export type HttpTransportResult = {
  transport: Transport
  kind: HttpTransportKind
}

function requestInit(headers?: Record<string, string> | null): RequestInit | undefined {
  if (!headers || Object.keys(headers).length === 0) return undefined
  return { headers: { ...headers } }
}

/**
 * Build an MCP client transport for remote HTTP servers.
 * Tries Streamable HTTP (current MCP spec), then falls back to legacy SSE.
 * Author: Dinesh Reddy Meka
 */
export async function createHttpMcpTransport(
  opts: CreateHttpTransportOptions,
): Promise<HttpTransportResult> {
  const url = new URL(opts.url)
  const init = requestInit(opts.headers)
  const order: HttpTransportKind[] = opts.preferSse
    ? ['sse', 'streamable-http']
    : ['streamable-http', 'sse']

  let lastError: unknown
  for (const kind of order) {
    try {
      if (kind === 'streamable-http') {
        const transport = new StreamableHTTPClientTransport(url, {
          requestInit: init,
          fetch: opts.fetch,
        })
        if (isDebugChannel('mcp')) {
          log.debug('MCP HTTP transport constructed', { kind, url: url.toString() })
        }
        return { transport, kind }
      }
      const transport = new SSEClientTransport(url, {
        requestInit: init,
        fetch: opts.fetch,
      })
      if (isDebugChannel('mcp')) {
        log.debug('MCP HTTP transport constructed', { kind, url: url.toString() })
      }
      return { transport, kind }
    } catch (err) {
      lastError = err
      if (isDebugChannel('mcp')) {
        log.debug('MCP HTTP transport construct failed', { kind, error: err })
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`Failed to create HTTP MCP transport for ${opts.url}`)
}

/**
 * Sync factory for preferSse / default streamable construction (no network).
 */
export function createHttpTransportSync(opts: CreateHttpTransportOptions): HttpTransportResult {
  const url = new URL(opts.url)
  const init = requestInit(opts.headers)
  if (opts.preferSse) {
    return {
      transport: new SSEClientTransport(url, { requestInit: init, fetch: opts.fetch }),
      kind: 'sse',
    }
  }
  return {
    transport: new StreamableHTTPClientTransport(url, {
      requestInit: init,
      fetch: opts.fetch,
    }),
    kind: 'streamable-http',
  }
}
