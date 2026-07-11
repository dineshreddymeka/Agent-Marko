import { jsonResponse, parseJson } from './helpers'

export async function handleProfiles(req: Request, path: string): Promise<Response | null> {
  const { profilesRepo } = await import('../db/repositories/profiles')
  const parts = path.split('/').filter(Boolean)

  if (req.method === 'GET' && parts.length === 2) {
    return jsonResponse(await profilesRepo.list())
  }

  if (req.method === 'POST' && parts.length === 2) {
    const body = await parseJson(req)
    if (!body?.name) return jsonResponse({ error: 'name required' }, 400)
    const profile = await profilesRepo.create({
      name: String(body.name),
      systemPrompt: body.systemPrompt ? String(body.systemPrompt) : undefined,
      model: body.model ? String(body.model) : undefined,
      temperature: typeof body.temperature === 'number' ? body.temperature : undefined,
      provider: body.provider as 'native' | 'agui-remote' | 'hermes-python' | undefined,
      providerConfig: body.providerConfig as Record<string, unknown> | null,
    })
    return jsonResponse(profile, 201)
  }

  if (parts.length === 3) {
    const id = parts[2]!
    if (req.method === 'GET') {
      const profile = await profilesRepo.getById(id)
      if (!profile) return jsonResponse({ error: 'Not found' }, 404)
      return jsonResponse(profile)
    }
    if (req.method === 'PATCH') {
      const body = await parseJson(req)
      const profile = await profilesRepo.update(id, body ?? {})
      if (!profile) return jsonResponse({ error: 'Not found' }, 404)
      return jsonResponse(profile)
    }
    if (req.method === 'DELETE') {
      return jsonResponse({ deleted: await profilesRepo.delete(id) })
    }
  }

  return null
}
