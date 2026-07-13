import { config } from '../../config'
import { registerTool } from './registry'
import { ToolError } from '../../errors'

export type WebSearchResult = {
  title: string
  url: string
  snippet: string
}

const SEARCH_CACHE_TTL_MS = 5 * 60_000
const FETCH_CACHE_TTL_MS = 15 * 60_000
const FETCH_MAX_BYTES = 200_000
const FETCH_TIMEOUT_MS = 8_000
const FETCH_TEXT_MAX_CHARS = 24_000

type CacheEntry<T> = { expiresAt: number; value: T }

const searchCache = new Map<string, CacheEntry<{ provider: string; query: string; results: WebSearchResult[] }>>()
const fetchCache = new Map<string, CacheEntry<Record<string, unknown>>>()

/** Test helper — clears in-memory TTL caches. */
export function clearWebCaches(): void {
  searchCache.clear()
  fetchCache.clear()
}

function cacheGet<T>(map: Map<string, CacheEntry<T>>, key: string): T | undefined {
  const hit = map.get(key)
  if (!hit) return undefined
  if (Date.now() > hit.expiresAt) {
    map.delete(key)
    return undefined
  }
  return hit.value
}

function cacheSet<T>(map: Map<string, CacheEntry<T>>, key: string, value: T, ttlMs: number): void {
  map.set(key, { value, expiresAt: Date.now() + ttlMs })
}

/** Strip HTML to readable text (shared pattern with chrome_get_content). */
export function htmlToReadableText(html: string, maxChars = FETCH_TEXT_MAX_CHARS): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxChars)
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

/** Official Google Programmable Search (Custom Search JSON API) — low latency, real Google index. */
async function searchGoogle(query: string, signal?: AbortSignal): Promise<WebSearchResult[]> {
  const key = config.WEB_SEARCH_API_KEY
  const cx = config.WEB_SEARCH_GOOGLE_CX.trim()
  if (!key) throw new ToolError('Google search requires WEB_SEARCH_API_KEY')
  if (!cx) throw new ToolError('Google search requires WEB_SEARCH_GOOGLE_CX (Programmable Search engine id)')
  const url = new URL('https://www.googleapis.com/customsearch/v1')
  url.searchParams.set('key', key)
  url.searchParams.set('cx', cx)
  url.searchParams.set('q', query)
  url.searchParams.set('num', '8')
  const res = await fetch(url, { signal, headers: { Accept: 'application/json' } })
  if (!res.ok) throw new ToolError(`Google search failed (${res.status})`)
  const json = (await res.json()) as {
    items?: Array<{ title?: string; link?: string; snippet?: string }>
  }
  return (json.items ?? []).map((r) => ({
    title: r.title ?? '',
    url: r.link ?? '',
    snippet: r.snippet ?? '',
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

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#x27;|&#39;/gi, "'")
    .trim()
}

/** DDG wraps result hrefs in a /l/?uddg= redirect — unwrap to the real URL. */
function unwrapDdgHref(href: string): string {
  try {
    const u = href.startsWith('//') ? new URL(`https:${href}`) : new URL(href, 'https://duckduckgo.com')
    const uddg = u.searchParams.get('uddg')
    if (uddg) return decodeURIComponent(uddg)
    return u.href
  } catch {
    return href
  }
}

/** Keyless real-web results via the DuckDuckGo HTML endpoint. */
async function searchDuckDuckGoHtml(query: string, signal?: AbortSignal): Promise<WebSearchResult[]> {
  const url = new URL('https://html.duckduckgo.com/html/')
  url.searchParams.set('q', query)
  const res = await fetch(url, {
    signal,
    headers: {
      Accept: 'text/html',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    },
  })
  if (!res.ok) throw new ToolError(`DuckDuckGo search failed (${res.status})`)
  const html = await res.text()

  const results: WebSearchResult[] = []
  const linkRe =
    /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi
  const snippetRe =
    /<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/gi

  const snippets: string[] = []
  for (let m = snippetRe.exec(html); m; m = snippetRe.exec(html)) {
    snippets.push(decodeHtmlEntities(m[1]!.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')))
  }

  let i = 0
  for (let m = linkRe.exec(html); m && results.length < 8; m = linkRe.exec(html), i++) {
    const href = unwrapDdgHref(m[1]!)
    const title = decodeHtmlEntities(m[2]!.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '))
    if (!href.startsWith('http') || !title) continue
    results.push({ title, url: href, snippet: snippets[i] ?? '' })
  }
  return results
}

/** Instant Answer API — abstracts only; kept as secondary keyless source. */
async function searchDuckDuckGoInstant(query: string, signal?: AbortSignal): Promise<WebSearchResult[]> {
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
      results.push({
        title: topic.Text.split(' - ')[0] ?? topic.Text,
        url: topic.FirstURL,
        snippet: topic.Text,
      })
    }
    if (results.length >= 8) break
  }
  return results
}

/** Keyless fallback: HTML SERP first (real results), Instant Answer as backup. */
async function searchDuckDuckGo(query: string, signal?: AbortSignal): Promise<WebSearchResult[]> {
  try {
    const results = await searchDuckDuckGoHtml(query, signal)
    if (results.length > 0) return results
  } catch {
    // fall through to Instant Answer
  }
  return searchDuckDuckGoInstant(query, signal)
}

async function raceKeyedProviders(
  query: string,
  signal?: AbortSignal,
): Promise<{ provider: string; results: WebSearchResult[] }> {
  const runners: Array<{ provider: string; run: () => Promise<WebSearchResult[]> }> = [
    ...(config.WEB_SEARCH_GOOGLE_CX.trim()
      ? [{ provider: 'google', run: () => searchGoogle(query, signal) }]
      : []),
    { provider: 'brave', run: () => searchBrave(query, signal) },
    { provider: 'tavily', run: () => searchTavily(query, signal) },
    { provider: 'serper', run: () => searchSerper(query, signal) },
  ]
  const wrapped = runners.map(async ({ provider, run }) => {
    const results = await run()
    return { provider, results }
  })
  try {
    return await Promise.any(wrapped)
  } catch {
    // AggregateError when every keyed provider fails — caller falls back to DDG.
    throw new ToolError('All keyed web search providers failed')
  }
}

export async function webSearch(
  query: string,
  signal?: AbortSignal,
): Promise<{
  provider: string
  query: string
  results: WebSearchResult[]
  cached?: boolean
}> {
  const provider = (config.WEB_SEARCH_PROVIDER || 'auto').toLowerCase()
  const hasKey = Boolean(config.WEB_SEARCH_API_KEY)
  const cacheKey = `search:${provider}:${hasKey ? 'k' : 'nk'}:${query.trim().toLowerCase()}`
  const cached = cacheGet(searchCache, cacheKey)
  if (cached) return { ...cached, cached: true }

  let out: { provider: string; query: string; results: WebSearchResult[] }

  if (provider === 'google') {
    out = { provider: 'google', query, results: await searchGoogle(query, signal) }
  } else if (provider === 'brave') {
    out = { provider: 'brave', query, results: await searchBrave(query, signal) }
  } else if (provider === 'tavily') {
    out = { provider: 'tavily', query, results: await searchTavily(query, signal) }
  } else if (provider === 'serper') {
    out = { provider: 'serper', query, results: await searchSerper(query, signal) }
  } else if (provider === 'duckduckgo') {
    out = { provider: 'duckduckgo', query, results: await searchDuckDuckGo(query, signal) }
  } else if (provider === 'auto' && hasKey) {
    try {
      const raced = await raceKeyedProviders(query, signal)
      out = { provider: raced.provider, query, results: raced.results }
    } catch {
      out = { provider: 'duckduckgo', query, results: await searchDuckDuckGo(query, signal) }
    }
  } else {
    out = { provider: 'duckduckgo', query, results: await searchDuckDuckGo(query, signal) }
  }

  cacheSet(searchCache, cacheKey, out, SEARCH_CACHE_TTL_MS)
  return out
}

export async function fetchUrlContent(
  target: string,
  opts: { maxBytes?: number; signal: AbortSignal },
): Promise<Record<string, unknown>> {
  let parsed: URL
  try {
    parsed = new URL(target)
  } catch {
    throw new ToolError(`Invalid URL: ${target}`)
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new ToolError('Only http(s) URLs are allowed')
  }

  const maxBytes = Math.min(Number(opts.maxBytes) || FETCH_MAX_BYTES, FETCH_MAX_BYTES)
  const cacheKey = `fetch:${parsed.toString()}:${maxBytes}`
  const cached = cacheGet(fetchCache, cacheKey)
  if (cached) return { ...cached, cached: true }

  const controller = new AbortController()
  const onAbort = () => controller.abort()
  opts.signal.addEventListener('abort', onAbort, { once: true })
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
    let text = new TextDecoder('utf-8', { fatal: false }).decode(slice)
    const isHtml = /html/i.test(contentType) || /^\s*</.test(text)
    const isJson = /json/i.test(contentType)
    if (isHtml && !isJson) {
      text = htmlToReadableText(text)
    }

    const out = {
      status: res.status,
      contentType,
      bytes: buf.byteLength,
      truncated,
      stripped: Boolean(isHtml && !isJson),
      content: text,
    }
    cacheSet(fetchCache, cacheKey, out, FETCH_CACHE_TTL_MS)
    return out
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new ToolError('fetch_url timed out or aborted')
    }
    throw new ToolError(String(err))
  } finally {
    clearTimeout(timer)
    opts.signal.removeEventListener('abort', onAbort)
  }
}

registerTool({
  name: 'web_search',
  description:
    'Search the live web for current facts, news, scores, prices, docs, and anything outside training data. Prefer this over guessing for "today", recent events, or unknown specifics. Then use fetch_url on the best result URL.',
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
  description:
    'Fetch a URL and return readable text (HTML stripped) or JSON. Use after web_search to read the best hit. Prefer over guessing page contents.',
  parameters: {
    type: 'object',
    properties: {
      url: { type: 'string' },
      maxBytes: { type: 'number' },
    },
    required: ['url'],
  },
  async execute(args, ctx) {
    return fetchUrlContent(String(args.url), {
      maxBytes: args.maxBytes as number | undefined,
      signal: ctx.signal,
    })
  },
})
