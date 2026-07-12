import { config } from '../../config'
import { registerTool } from './registry'
import { ToolError } from '../../errors'

export type WebSearchResult = {
  title: string
  url: string
  snippet: string
}

async function searchBrave(query: string, signal?: AbortSignal): Promise<WebSearchResult[]> {
  const key = config.WEB_SEARCH_API_KEY
  if (!key) throw new ToolError('BRAVE search requires WEB_SEARCH_API_KEY')
  const url = new URL('https://api.search.brave.com/res/v1/web/search')
  url.searchParams.set('q', query)
  url.searchParams.set('count', '8')
  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'X-Subscription-Token': key },
    signal,
  })
  if (!res.ok) throw new ToolError(`Brave search failed (${res.status})`)
  const json = (await res.json()) as {
    web?: { results?: Array<{ title?: string; url?: string; description?: string }> }
  }
  return (json.web?.results ?? []).map((r) => ({
    title: r.title ?? '',
    url: r.url ?? '',
    snippet: r.description ?? '',
  }))
}

async function searchTavily(query: string, signal?: AbortSignal): Promise<WebSearchResult[]> {
  const key = config.WEB_SEARCH_API_KEY
  if (!key) throw new ToolError('Tavily search requires WEB_SEARCH_API_KEY')
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: key, query, max_results: 8 }),
    signal,
  })
  if (!res.ok) throw new ToolError(`Tavily search failed (${res.status})`)
  const json = (await res.json()) as {
    results?: Array<{ title?: string; url?: string; content?: string }>
  }
  return (json.results ?? []).map((r) => ({
    title: r.title ?? '',
    url: r.url ?? '',
    snippet: r.content ?? '',
  }))
}

async function searchSerper(query: string, signal?: AbortSignal): Promise<WebSearchResult[]> {
  const key = config.WEB_SEARCH_API_KEY
  if (!key) throw new ToolError('Serper search requires WEB_SEARCH_API_KEY')
  const res = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-KEY': key },
    body: JSON.stringify({ q: query, num: 8 }),
    signal,
  })
  if (!res.ok) throw new ToolError(`Serper search failed (${res.status})`)
  const json = (await res.json()) as {
    organic?: Array<{ title?: string; link?: string; snippet?: string }>
  }
  return (json.organic ?? []).map((r) => ({
    title: r.title ?? '',
    url: r.link ?? '',
    snippet: r.snippet ?? '',
  }))
}

/** Keyless fallback via DuckDuckGo Instant Answer API */
async function searchDuckDuckGo(query: string, signal?: AbortSignal): Promise<WebSearchResult[]> {
  const url = new URL('https://api.duckduckgo.com/')
  url.searchParams.set('q', query)
  url.searchParams.set('format', 'json')
  url.searchParams.set('no_redirect', '1')
  url.searchParams.set('no_html', '1')
  const res = await fetch(url, { signal, headers: { Accept: 'application/json' } })
  if (!res.ok) throw new ToolError(`DuckDuckGo search failed (${res.status})`)
  const json = (await res.json()) as {
    AbstractText?: string
    AbstractURL?: string
    Heading?: string
    RelatedTopics?: Array<{ Text?: string; FirstURL?: string; Topics?: unknown[] }>
  }
  const results: WebSearchResult[] = []
  if (json.AbstractText) {
    results.push({
      title: json.Heading || query,
      url: json.AbstractURL || '',
      snippet: json.AbstractText,
    })
  }
  for (const topic of json.RelatedTopics ?? []) {
    if (topic.Text && topic.FirstURL) {
      results.push({ title: topic.Text.split(' - ')[0] ?? topic.Text, url: topic.FirstURL, snippet: topic.Text })
    }
    if (results.length >= 8) break
  }
  return results
}

export async function webSearch(query: string, signal?: AbortSignal): Promise<{
  provider: string
  query: string
  results: WebSearchResult[]
}> {
  const provider = (config.WEB_SEARCH_PROVIDER || 'auto').toLowerCase()
  const hasKey = Boolean(config.WEB_SEARCH_API_KEY)

  if (provider === 'brave' || (provider === 'auto' && hasKey && config.WEB_SEARCH_PROVIDER === 'brave')) {
    return { provider: 'brave', query, results: await searchBrave(query, signal) }
  }
  if (provider === 'tavily') {
    return { provider: 'tavily', query, results: await searchTavily(query, signal) }
  }
  if (provider === 'serper') {
    return { provider: 'serper', query, results: await searchSerper(query, signal) }
  }
  if (provider === 'auto' && hasKey) {
    // Prefer Brave when key present but provider unset-ish; try brave then tavily
    try {
      return { provider: 'brave', query, results: await searchBrave(query, signal) }
    } catch {
      try {
        return { provider: 'tavily', query, results: await searchTavily(query, signal) }
      } catch {
        return { provider: 'serper', query, results: await searchSerper(query, signal) }
      }
    }
  }
  return { provider: 'duckduckgo', query, results: await searchDuckDuckGo(query, signal) }
}

const FETCH_MAX_BYTES = 200_000
const FETCH_TIMEOUT_MS = 20_000

registerTool({
  name: 'web_search',
  description: 'Search the web (Brave/Tavily/Serper with WEB_SEARCH_API_KEY, else DuckDuckGo)',
  parameters: {
    type: 'object',
    properties: { query: { type: 'string' } },
    required: ['query'],
  },
  async execute(args, ctx) {
    return webSearch(String(args.query), ctx.signal)
  },
})

registerTool({
  name: 'fetch_url',
  description: 'Fetch URL content with size/timeout limits',
  parameters: {
    type: 'object',
    properties: {
      url: { type: 'string' },
      maxBytes: { type: 'number' },
    },
    required: ['url'],
  },
  async execute(args, ctx) {
    const target = String(args.url)
    let parsed: URL
    try {
      parsed = new URL(target)
    } catch {
      throw new ToolError(`Invalid URL: ${target}`)
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new ToolError('Only http(s) URLs are allowed')
    }

    const maxBytes = Math.min(Number(args.maxBytes) || FETCH_MAX_BYTES, FETCH_MAX_BYTES)
    const controller = new AbortController()
    const onAbort = () => controller.abort()
    ctx.signal.addEventListener('abort', onAbort, { once: true })
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

    try {
      const res = await fetch(target, {
        signal: controller.signal,
        headers: { Accept: 'text/html,application/json,text/plain,*/*' },
        redirect: 'follow',
      })
      const contentType = res.headers.get('content-type') ?? 'application/octet-stream'
      const buf = new Uint8Array(await res.arrayBuffer())
      const truncated = buf.byteLength > maxBytes
      const slice = truncated ? buf.slice(0, maxBytes) : buf
      const text = new TextDecoder('utf-8', { fatal: false }).decode(slice)
      return {
        status: res.status,
        contentType,
        bytes: buf.byteLength,
        truncated,
        content: text,
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new ToolError('fetch_url timed out or aborted')
      }
      throw new ToolError(String(err))
    } finally {
      clearTimeout(timer)
      ctx.signal.removeEventListener('abort', onAbort)
    }
  },
})
