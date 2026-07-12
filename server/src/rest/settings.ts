import { jsonResponse, parseJson } from './helpers'
import { requireDatabaseOrResponse, withDatabase } from './db-guard'

const SENSITIVE_KEYS = new Set(['llm_api_key', 'api_key', 'openai_api_key', 'office_graph_token'])

function maskSettings(all: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...all }
  for (const key of SENSITIVE_KEYS) {
    if (typeof out[key] === 'string' && (out[key] as string).length > 0) {
      const v = out[key] as string
      out[key] = v.length <= 4 ? '••••' : `••••${v.slice(-4)}`
      out[`${key}_set`] = true
    } else if (out[key] !== undefined && out[key] !== null) {
      out[key] = '••••set'
      out[`${key}_set`] = true
    }
  }
  return out
}

export async function handleSettings(req: Request, path: string): Promise<Response | null> {
  const { settingsRepo } = await import('../db/repositories/settings')
  const parts = path.split('/').filter(Boolean)

  if (req.method === 'GET' && parts.length === 2) {
    const all = await withDatabase(() => settingsRepo.getAll(), {})
    return jsonResponse(maskSettings(all))
  }

  if (req.method === 'PUT' && parts.length === 2) {
    const unavailable = await requireDatabaseOrResponse()
    if (unavailable) return unavailable
    const body = await parseJson<Record<string, unknown>>(req)
    if (!body) return jsonResponse({ error: 'Invalid JSON' }, 400)
    for (const [key, value] of Object.entries(body)) {
      if (typeof value === 'string' && value.startsWith('••••')) continue
      await settingsRepo.set(key, value)
    }
    return jsonResponse(maskSettings(await settingsRepo.getAll()))
  }

  if (req.method === 'GET' && parts.length === 3 && parts[2] === 'export') {
    const unavailable = await requireDatabaseOrResponse()
    if (unavailable) return unavailable
    const [{ sessionsRepo }, { memoryRepo }, { skillsRepo }, { profilesRepo }] = await Promise.all([
      import('../db/repositories/sessions'),
      import('../db/repositories/memory'),
      import('../db/repositories/skills'),
      import('../db/repositories/profiles'),
    ])
    const [sessions, memory, skills, profiles, settings] = await Promise.all([
      sessionsRepo.list({ limit: 500 }),
      memoryRepo.list(),
      skillsRepo.list(),
      profilesRepo.list(),
      settingsRepo.getAll(),
    ])
    return jsonResponse({
      exportedAt: new Date().toISOString(),
      product: 'Open Jarvis',
      sessions,
      memory,
      skills,
      profiles,
      settings: maskSettings(settings),
    })
  }

  return null
}
