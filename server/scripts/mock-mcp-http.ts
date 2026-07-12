/**
 * Minimal streamable-HTTP MCP server for local Connect/Test verification.
 * Listens on 127.0.0.1:3921. Stateless: new transport per request.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { z } from 'zod'

const port = Number(process.env.MOCK_MCP_PORT ?? 3921)

function createServer() {
  const mcp = new McpServer({ name: 'mock-mcp', version: '0.0.1' })
  mcp.registerTool(
    'echo',
    {
      description: 'Echo a message',
      inputSchema: { message: z.string() },
    },
    async ({ message }) => ({
      content: [{ type: 'text' as const, text: String(message) }],
    }),
  )
  mcp.registerTool(
    'document_outline',
    {
      description: 'Return a document outline for a topic (mock research helper)',
      inputSchema: {
        topic: z.string(),
        deliverable: z.enum(['markdown', 'presentation', 'pdf', 'word']).optional(),
      },
    },
    async ({ topic, deliverable }) => {
      const kind = deliverable ?? 'markdown'
      const outline = [
        `# ${topic}`,
        '',
        `Deliverable: ${kind}`,
        '',
        '1. Executive summary',
        '2. Background',
        '3. Key findings',
        '4. Recommendations',
        '5. Next steps',
      ].join('\n')
      return { content: [{ type: 'text' as const, text: outline }] }
    },
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

console.log(`mock MCP listening on http://127.0.0.1:${port}/mcp`)
