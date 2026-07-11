import { registerTool } from './registry'

registerTool({
  name: 'web_search',
  description: 'Search the web (stub — configure external provider)',
  parameters: {
    type: 'object',
    properties: { query: { type: 'string' } },
    required: ['query'],
  },
  async execute(args) {
    return {
      stub: true,
      message: 'web_search is not configured. Set up a search API provider.',
      query: String(args.query),
      results: [],
    }
  },
})

registerTool({
  name: 'fetch_url',
  description: 'Fetch URL content (stub)',
  parameters: {
    type: 'object',
    properties: { url: { type: 'string' } },
    required: ['url'],
  },
  async execute(args, ctx) {
    try {
      const res = await fetch(String(args.url), { signal: ctx.signal })
      const text = await res.text()
      return { status: res.status, content: text.slice(0, 50_000) }
    } catch (err) {
      return { error: String(err) }
    }
  },
})
