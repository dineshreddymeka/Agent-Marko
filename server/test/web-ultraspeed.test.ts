import { describe, expect, test, beforeEach, afterEach, mock } from 'bun:test'
import {
  clearWebCaches,
  fetchUrlContent,
  htmlToReadableText,
  webSearch,
} from '../src/agent/tools/web'
import { CORE_TOOL_NAMES } from '../src/capabilities/retrieve'

describe('ultraspeed web helpers', () => {
  beforeEach(() => {
    clearWebCaches()
  })

  afterEach(() => {
    clearWebCaches()
  })

  test('htmlToReadableText strips tags and scripts', () => {
    const text = htmlToReadableText(
      '<html><head><script>alert(1)</script><style>.x{}</style></head><body><h1>Hello</h1><p>World &amp; friends</p></body></html>',
    )
    expect(text).toContain('Hello')
    expect(text).toContain('World & friends')
    expect(text).not.toContain('<script')
    expect(text).not.toContain('alert')
  })

  test('CORE_TOOL_NAMES includes fetch_url and web_search', () => {
    expect(CORE_TOOL_NAMES.includes('fetch_url')).toBe(true)
    expect(CORE_TOOL_NAMES.includes('web_search')).toBe(true)
  })

  test('fetch_url cache hit skips network on second call', async () => {
    let fetches = 0
    const originalFetch = globalThis.fetch
    globalThis.fetch = mock(async () => {
      fetches++
      return new Response('<html><body><p>Cached page</p></body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      })
    }) as typeof fetch

    try {
      const signal = AbortSignal.timeout(5_000)
      const first = await fetchUrlContent('https://example.test/page', { signal })
      const second = await fetchUrlContent('https://example.test/page', { signal })
      expect(fetches).toBe(1)
      expect(first.stripped).toBe(true)
      expect(String(first.content)).toContain('Cached page')
      expect(second.cached).toBe(true)
      expect(String(second.content)).toContain('Cached page')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('web_search cache hit skips network on second identical query', async () => {
    let fetches = 0
    const originalFetch = globalThis.fetch
    const ddgBody = JSON.stringify({
      Heading: 'Test',
      AbstractText: 'A snippet',
      AbstractURL: 'https://example.test',
      RelatedTopics: [],
    })
    const keyedBody = JSON.stringify({
      web: { results: [{ title: 'Keyed', url: 'https://example.test', description: 'snippet' }] },
      results: [{ title: 'Keyed', url: 'https://example.test', content: 'snippet' }],
      organic: [{ title: 'Keyed', link: 'https://example.test', snippet: 'snippet' }],
    })

    // Mock by URL so the test is robust whether config is auto/ddg/brave/tavily/serper.
    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      fetches++
      const url = String(input instanceof Request ? input.url : input)
      if (url.includes('duckduckgo.com')) {
        return new Response(ddgBody, {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      if (url.includes('api.search.brave.com')) {
        return new Response(keyedBody, {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      if (url.includes('api.tavily.com')) {
        return new Response(keyedBody, {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      if (url.includes('google.serper.dev')) {
        return new Response(keyedBody, {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      return new Response(ddgBody, {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }) as typeof fetch

    try {
      const signal = AbortSignal.timeout(5_000)
      const q = `ultraspeed-cache-${Date.now()}`
      const first = await webSearch(q, signal)
      const second = await webSearch(q, signal)
      expect(first.results.length).toBeGreaterThanOrEqual(0)
      expect(second.cached).toBe(true)
      expect(fetches).toBeGreaterThanOrEqual(1)
      // Second call must not hit the network again (cache key is query+provider).
      const fetchesAfterFirst = fetches
      await webSearch(q, signal)
      expect(fetches).toBe(fetchesAfterFirst)
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
