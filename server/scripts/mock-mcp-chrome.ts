/**
 * Mock Chrome MCP server (streamable HTTP) for Connect/Test + document research scenarios.
 * Tools: chrome_open, chrome_get_content, chrome_screenshot, list_tabs
 *
 *   bun run server/scripts/mock-mcp-chrome.ts
 *   → http://127.0.0.1:3922/mcp
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { z } from 'zod'

const port = Number(process.env.MOCK_MCP_CHROME_PORT ?? 3922)

type Tab = { id: string; url: string; title: string }
const tabs = new Map<string, Tab>()
let activeTabId: string | null = null

function createServer() {
  const mcp = new McpServer({ name: 'mock-chrome-mcp', version: '0.0.1' })

  mcp.registerTool(
    'chrome_open',
    {
      description: 'Open a URL in a mock Chrome tab',
      inputSchema: { url: z.string().url() },
    },
    async ({ url }) => {
      const id = `tab-${tabs.size + 1}`
      const title = `Mock — ${new URL(url).hostname}`
      tabs.set(id, { id, url, title })
      activeTabId = id
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ ok: true, tabId: id, url, title }) }],
      }
    },
  )

  mcp.registerTool(
    'chrome_get_content',
    {
      description: 'Get mock page text for the active (or given) tab',
      inputSchema: { tabId: z.string().optional(), maxChars: z.number().optional() },
    },
    async ({ tabId, maxChars }) => {
      const id = tabId ?? activeTabId
      if (!id || !tabs.has(id)) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ ok: false, error: 'no active tab' }) }],
          isError: true,
        }
      }
      const tab = tabs.get(id)!
      const max = Math.min(5000, Math.max(100, maxChars ?? 1500))
      const text =
        `Mock Chrome content for ${tab.url}. Use this research excerpt when drafting a document or Cowork PPT/PDF brief.`
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              ok: true,
              tabId: id,
              url: tab.url,
              title: tab.title,
              text: text.slice(0, max),
            }),
          },
        ],
      }
    },
  )

  mcp.registerTool(
    'chrome_screenshot',
    {
      description: 'Return a mock screenshot path for the active tab',
      inputSchema: { tabId: z.string().optional() },
    },
    async ({ tabId }) => {
      const id = tabId ?? activeTabId
      if (!id || !tabs.has(id)) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ ok: false, error: 'no active tab' }) }],
          isError: true,
        }
      }
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              ok: true,
              tabId: id,
              relativePath: `chrome-captures/mcp-${id}.png`,
              mock: true,
            }),
          },
        ],
      }
    },
  )

  mcp.registerTool(
    'list_tabs',
    {
      description: 'List open mock Chrome tabs',
      inputSchema: {},
    },
    async () => ({
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({
            ok: true,
            activeTabId,
            tabs: [...tabs.values()],
          }),
        },
      ],
    }),
  )

  return mcp
}

Bun.serve({
  port,
  hostname: '127.0.0.1',
  async fetch(req) {
    const url = new URL(req.url)
    if (url.pathname !== '/mcp' && url.pathname !== '/') {
      return new Response('Not found', { status: 404 })
    }
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    })
    const mcp = createServer()
    await mcp.connect(transport)
    return transport.handleRequest(req)
  },
})

console.log(`mock Chrome MCP listening on http://127.0.0.1:${port}/mcp`)
