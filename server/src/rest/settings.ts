import { jsonResponse, parseJson } from './helpers'

export async function handleSettings(req: Request, path: string): Promise<Response | null> {
  const { settingsRepo } = await import('../db/repositories/settings')
  const parts = path.split('/').filter(Boolean)

  if (req.method === 'GET' && parts.length === 2) {
    return jsonResponse(await settingsRepo.getAll())
  }

  if (req.method === 'PUT' && parts.length === 2) {
    const body = await parseJson<Record<string, unknown>>(req)
    if (!body) return jsonResponse({ error: 'Invalid JSON' }, 400)
    for (const [key, value] of Object.entries(body)) {
      await settingsRepo.set(key, value)
    }
    return jsonResponse(await settingsRepo.getAll())
  }

  return null
}
