/**
 * Live internet feature tests — real HTTP against public sites.
 * Run with: HERMES_CHROME_MOCK=0 bun test server/test/live-internet.test.ts
 *
 * Skipped when HERMES_LIVE_NET=0 (CI default for offline sandboxes).
 */
import { describe, expect, test, beforeAll, afterAll } from 'bun:test'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { getTool } from '../src/agent/tools/registry'
import '../src/agent/tools/web'
import '../src/agent/tools/chrome'
import { resetChromeSession } from '../src/agent/tools/chrome'
import { webSearch } from '../src/agent/tools/web'

const liveEnabled = (() => {
  const v = (process.env.HERMES_LIVE_NET ?? '1').trim().toLowerCase()
  return v !== '0' && v !== 'false' && v !== 'no' && v !== 'off'
})()

const describeLive = liveEnabled ? describe : describe.skip

const ctx = {
  sessionId: 'live-net',
  runId: 'live-run',
  signal: AbortSignal.timeout(30_000),
}

describeLive('live internet — web_search + fetch_url + chrome', () => {
  beforeAll(() => {
    process.env.HERMES_CHROME_MOCK = '0'
    process.env.WEB_SEARCH_PROVIDER = 'duckduckgo'
    delete process.env.WEB_SEARCH_API_KEY
    resetChromeSession()
    const ws = process.env.HERMES_WORKSPACE_ROOT || join(process.cwd(), '..', 'workspace')
    mkdirSync(join(ws, 'chrome-captures'), { recursive: true })
  })

  afterAll(() => {
    resetChromeSession()
  })

  test(
    'web_search DuckDuckGo returns real results for Wikipedia query',
    async () => {
      const result = await webSearch('Python programming language', AbortSignal.timeout(20_000))
      expect(result.provider).toBe('duckduckgo')
      expect(result.query).toBe('Python programming language')
      // Instant Answer API can be sparse; accept abstract OR related topics
      expect(result.results.length).toBeGreaterThan(0)
      const hasUrl = result.results.some((r) => r.url.includes('http'))
      expect(hasUrl || result.results.some((r) => r.snippet.length > 10)).toBe(true)
    },
    { timeout: 30_000 },
  )

  test(
    'fetch_url loads example.com HTML',
    async () => {
      const out = (await getTool('fetch_url')!.execute(
        { url: 'https://example.com' },
        ctx,
      )) as { status: number; content: string; contentType: string }
      expect(out.status).toBe(200)
      expect(out.content.toLowerCase()).toContain('example domain')
      expect(out.contentType).toMatch(/text\/html/i)
    },
    { timeout: 30_000 },
  )

  test(
    'fetch_url loads public JSON API',
    async () => {
      const out = (await getTool('fetch_url')!.execute(
        { url: 'https://jsonplaceholder.typicode.com/todos/1' },
        ctx,
      )) as { status: number; content: string }
      expect(out.status).toBe(200)
      const json = JSON.parse(out.content) as { id?: number; title?: string; userId?: number }
      expect(json.id).toBe(1)
      expect(typeof json.title).toBe('string')
      expect(json.title!.length).toBeGreaterThan(0)
    },
    { timeout: 30_000 },
  )

  test(
    'fetch_url loads MDN docs page',
    async () => {
      const out = (await getTool('fetch_url')!.execute(
        { url: 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/200' },
        ctx,
      )) as { status: number; content: string }
      expect(out.status).toBe(200)
      expect(out.content).toMatch(/200|OK|Successful/i)
    },
    { timeout: 30_000 },
  )

  test(
    'chrome_open live: example.com title',
    async () => {
      resetChromeSession()
      const open = (await getTool('chrome_open')!.execute(
        { url: 'https://example.com' },
        ctx,
      )) as { ok: boolean; mock: boolean; title: string; url: string }
      expect(open.ok).toBe(true)
      expect(open.mock).toBe(false)
      expect(open.title.toLowerCase()).toContain('example')
    },
    { timeout: 30_000 },
  )

  test(
    'chrome_get_content live: strips HTML from wikipedia',
    async () => {
      resetChromeSession()
      await getTool('chrome_open')!.execute(
        { url: 'https://en.wikipedia.org/wiki/Open_source' },
        ctx,
      )
      const content = (await getTool('chrome_get_content')!.execute(
        { maxChars: 3000 },
        ctx,
      )) as { ok: boolean; mock: boolean; text: string; title: string }
      expect(content.ok).toBe(true)
      expect(content.mock).toBe(false)
      expect(content.text.length).toBeGreaterThan(100)
      expect(content.text.toLowerCase()).toMatch(/open.?source|software|source code/)
      expect(content.text).not.toMatch(/<script/i)
    },
    { timeout: 30_000 },
  )

  test(
    'chrome_navigate + screenshot live chain',
    async () => {
      resetChromeSession()
      await getTool('chrome_open')!.execute({ url: 'https://example.com' }, ctx)
      const nav = (await getTool('chrome_navigate')!.execute(
        { url: 'https://www.rfc-editor.org/rfc/rfc2616' },
        ctx,
      )) as { ok: boolean; mock: boolean; url: string; title: string }
      expect(nav.ok).toBe(true)
      expect(nav.mock).toBe(false)
      expect(nav.url).toContain('rfc-editor.org')

      const shot = (await getTool('chrome_screenshot')!.execute(
        { name: 'live-rfc2616' },
        ctx,
      )) as { ok: boolean; relativePath: string }
      expect(shot.ok).toBe(true)
      expect(shot.relativePath).toContain('chrome-captures/live-rfc2616.png')
    },
    { timeout: 45_000 },
  )

  test('chrome_open rejects file:// even in live mode', async () => {
    resetChromeSession()
    await expect(
      getTool('chrome_open')!.execute({ url: 'file:///etc/passwd' }, ctx),
    ).rejects.toThrow(/http/i)
  })
})
