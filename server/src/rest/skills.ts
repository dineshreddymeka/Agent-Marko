import { jsonResponse, parseJson } from './helpers'

export async function handleSkills(req: Request, path: string): Promise<Response | null> {
  const { skillsRepo } = await import('../db/repositories/skills')
  const parts = path.split('/').filter(Boolean)

  if (req.method === 'GET' && parts.length === 2) {
    return jsonResponse(await skillsRepo.list())
  }

  if (req.method === 'POST' && parts.length === 3 && parts[2] === 'sync') {
    const { syncSkillsFromDisk } = await import('../skills/loader')
    const count = await syncSkillsFromDisk()
    return jsonResponse({ synced: count })
  }

  if (req.method === 'POST' && parts.length === 2) {
    const body = await parseJson(req)
    if (!body?.name || !body?.bodyMd) {
      return jsonResponse({ error: 'name and bodyMd required' }, 400)
    }
    const skill = await skillsRepo.upsert({
      name: String(body.name),
      description: body.description ? String(body.description) : null,
      bodyMd: String(body.bodyMd),
      source: String(body.source ?? 'user-folder'),
      path: body.path ? String(body.path) : null,
    })
    return jsonResponse(skill, 201)
  }

  if (parts.length === 3) {
    const id = parts[2]!
    if (req.method === 'GET') {
      const skill = await skillsRepo.getById(id)
      if (!skill) return jsonResponse({ error: 'Not found' }, 404)
      return jsonResponse(skill)
    }
    if (req.method === 'DELETE') {
      return jsonResponse({ deleted: await skillsRepo.delete(id) })
    }
  }

  return null
}
