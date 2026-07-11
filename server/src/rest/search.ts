import { jsonResponse } from './helpers'

export async function handleSearch(req: Request, path: string): Promise<Response | null> {
  const parts = path.split('/').filter(Boolean)
  if (req.method !== 'GET' || parts.length !== 2) return null

  const url = new URL(req.url)
  const q = url.searchParams.get('q')
  if (!q) return jsonResponse({ error: 'q required' }, 400)

  const { hybridSearch } = await import('../vector/search')
  const results = await hybridSearch(q)
  return jsonResponse({ query: q, results })
}
