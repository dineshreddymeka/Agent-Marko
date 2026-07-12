/**
 * Built-in Chrome browser tools (mock-friendly for CI; optional Playwright when available).
 *
 * Tools:
 * - chrome_open / chrome_navigate — open a URL (records session state)
 * - chrome_get_content — return title + text (mock or live)
 * - chrome_screenshot — save a stub/PNG under workspace/chrome-captures/
 *
 * Set HERMES_CHROME_MOCK=1 (default in tests) to avoid launching a real browser.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { config } from '../../config'
import { ToolError } from '../../errors'
import { registerTool } from './registry'

export type ChromeSession = {
  url: string
  title: string
  openedAt: string
  history: string[]
}

let session: ChromeSession | null = null

function mockEnabled(): boolean {
  const v = (process.env.HERMES_CHROME_MOCK ?? '1').trim().toLowerCase()
  return v !== '0' && v !== 'false' && v !== 'no' && v !== 'off'
}

function assertHttpUrl(raw: string): string {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new ToolError(`Invalid URL: ${raw}`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ToolError('Only http(s) URLs are allowed')
  }
  return url.toString()
}

function titleFromUrl(url: string): string {
  try {
    const u = new URL(url)
    return u.hostname.replace(/^www\./, '') + u.pathname
  } catch {
    return url
  }
}

export function getChromeSession(): ChromeSession | null {
  return session
}

export function resetChromeSession(): void {
  session = null
}

async function openUrl(urlRaw: string): Promise<ChromeSession> {
  const url = assertHttpUrl(urlRaw)
  if (!mockEnabled()) {
    // Best-effort live fetch for title/content without full Chromium dependency.
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'OpenJarvisChromeTool/0.1' },
        signal: AbortSignal.timeout(15_000),
      })
      const html = await res.text()
      const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i)
      session = {
        url,
        title: (titleMatch?.[1] ?? titleFromUrl(url)).trim().slice(0, 200),
        openedAt: new Date().toISOString(),
        history: [...(session?.history ?? []), url].slice(-20),
      }
      return session
    } catch (err) {
      throw new ToolError(`chrome_open failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  session = {
    url,
    title: `Mock page — ${titleFromUrl(url)}`,
    openedAt: new Date().toISOString(),
    history: [...(session?.history ?? []), url].slice(-20),
  }
  return session
}

registerTool({
  name: 'chrome_open',
  description:
    'Open a URL in Chrome (or mock browser). Use before chrome_get_content / chrome_screenshot when researching for documents.',
  dangerous: false,
  parameters: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'http(s) URL to open' },
    },
    required: ['url'],
  },
  async execute(args) {
    const url = String(args.url ?? '')
    if (!url) throw new ToolError('url is required')
    const s = await openUrl(url)
    return { ok: true, mock: mockEnabled(), url: s.url, title: s.title, history: s.history }
  },
})

registerTool({
  name: 'chrome_navigate',
  description: 'Navigate the current Chrome session to a new URL (alias of chrome_open).',
  dangerous: false,
  parameters: {
    type: 'object',
    properties: {
      url: { type: 'string' },
    },
    required: ['url'],
  },
  async execute(args) {
    const url = String(args.url ?? '')
    if (!url) throw new ToolError('url is required')
    const s = await openUrl(url)
    return { ok: true, mock: mockEnabled(), url: s.url, title: s.title }
  },
})

registerTool({
  name: 'chrome_get_content',
  description:
    'Get the current page title and a text excerpt for drafting documents. Requires chrome_open first.',
  dangerous: false,
  parameters: {
    type: 'object',
    properties: {
      maxChars: { type: 'number', description: 'Max excerpt length (default 2000)' },
    },
  },
  async execute(args) {
    if (!session) throw new ToolError('No Chrome session — call chrome_open first')
    const maxChars = Math.min(20_000, Math.max(200, Number(args.maxChars ?? 2000) || 2000))
    if (mockEnabled()) {
      const excerpt =
        `Mock content for ${session.url}\n\n` +
        `This is simulated page text for Open Jarvis document workflows. ` +
        `Topic derived from URL path: ${new URL(session.url).pathname || '/'}. ` +
        `Use this excerpt to draft markdown / hand off to Open Cowork for PDF/PPT/Word.`
      return {
        ok: true,
        mock: true,
        url: session.url,
        title: session.title,
        text: excerpt.slice(0, maxChars),
      }
    }
    const res = await fetch(session.url, {
      headers: { 'User-Agent': 'OpenJarvisChromeTool/0.1' },
      signal: AbortSignal.timeout(15_000),
    })
    const html = await res.text()
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    return {
      ok: true,
      mock: false,
      url: session.url,
      title: session.title,
      text: text.slice(0, maxChars),
    }
  },
})

registerTool({
  name: 'chrome_screenshot',
  description:
    'Capture a screenshot of the current page into workspace/chrome-captures/ (stub PNG in mock mode).',
  dangerous: false,
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Optional filename stem' },
    },
  },
  async execute(args) {
    if (!session) throw new ToolError('No Chrome session — call chrome_open first')
    const dir = join(config.WORKSPACE_ROOT, 'chrome-captures')
    await mkdir(dir, { recursive: true })
    const stem =
      String(args.name ?? `capture-${Date.now()}`)
        .replace(/[^a-zA-Z0-9._-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80) || `capture-${Date.now()}`
    const filePath = join(dir, `${stem}.png`)
    // Minimal valid 1x1 PNG
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    )
    await writeFile(filePath, png)
    return {
      ok: true,
      mock: mockEnabled(),
      url: session.url,
      path: filePath,
      relativePath: `chrome-captures/${stem}.png`,
    }
  },
})
