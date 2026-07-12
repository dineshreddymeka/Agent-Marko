import { jsonResponse, parseJson } from './helpers'

export async function handleApiTokens(req: Request, path: string): Promise<Response | null> {
  const parts = path.split('/').filter(Boolean)
  // /api/tokens or /api/settings/tokens
  const isTokens =
    (parts[1] === 'tokens' && parts.length >= 2) ||
    (parts[1] === 'settings' && parts[2] === 'tokens')
  if (!isTokens) return null

  const { apiTokensRepo } = await import('../db/repositories/api_tokens')
  const tokenParts = parts[1] === 'settings' ? parts.slice(3) : parts.slice(2)

  if (req.method === 'GET' && tokenParts.length === 0) {
    return jsonResponse({ tokens: await apiTokensRepo.list() })
  }

  if (req.method === 'POST' && tokenParts.length === 0) {
    const body = await parseJson(req)
    if (!body?.name) return jsonResponse({ error: 'name required' }, 400)
    const token = await apiTokensRepo.create({
      name: String(body.name),
      scopes: Array.isArray(body.scopes) ? body.scopes.map(String) : ['*'],
    })
    return jsonResponse(token, 201)
  }

  if (tokenParts.length === 1 && req.method === 'DELETE') {
    return jsonResponse({ deleted: await apiTokensRepo.delete(tokenParts[0]!) })
  }

  return null
}
