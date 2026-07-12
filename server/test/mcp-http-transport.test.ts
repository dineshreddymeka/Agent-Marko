import { describe, expect, test } from 'bun:test'
import {
  createHttpMcpTransport,
  createHttpTransportSync,
} from '../src/mcp/http-transport'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'

describe('MCP HTTP client factory', () => {
  test('createHttpTransportSync defaults to streamable-http', () => {
    const { transport, kind } = createHttpTransportSync({
      url: 'http://127.0.0.1:9999/mcp',
      headers: { Authorization: 'Bearer test' },
    })
    expect(kind).toBe('streamable-http')
    expect(transport).toBeInstanceOf(StreamableHTTPClientTransport)
  })

  test('createHttpTransportSync preferSse uses SSE transport', () => {
    const { transport, kind } = createHttpTransportSync({
      url: 'http://127.0.0.1:9999/sse',
      preferSse: true,
      headers: { 'X-Api-Key': 'k' },
    })
    expect(kind).toBe('sse')
    expect(transport).toBeInstanceOf(SSEClientTransport)
  })

  test('createHttpMcpTransport returns streamable-http first', async () => {
    const mockFetch = (async () => new Response('ok')) as typeof fetch
    const result = await createHttpMcpTransport({
      url: 'https://example.com/mcp',
      headers: { Authorization: 'Bearer mock' },
      fetch: mockFetch,
    })
    expect(result.kind).toBe('streamable-http')
    expect(result.transport).toBeInstanceOf(StreamableHTTPClientTransport)
  })

  test('createHttpMcpTransport preferSse orders SSE first', async () => {
    const result = await createHttpMcpTransport({
      url: 'https://example.com/sse',
      preferSse: true,
    })
    expect(result.kind).toBe('sse')
    expect(result.transport).toBeInstanceOf(SSEClientTransport)
  })

  test('rejects invalid URL', () => {
    expect(() =>
      createHttpTransportSync({
        url: 'not-a-url',
      }),
    ).toThrow()
  })
})
