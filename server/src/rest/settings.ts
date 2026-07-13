import { jsonResponse, parseJson } from './helpers'
import { requireDatabaseOrResponse, withDatabase } from './db-guard'
import { WORKSPACE_ROOT_SETTING } from '../workspace/root'
import { allowDbPathSettings, isEnvSet } from '../paths'

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
    const { config } = await import('../config')
    const all = await withDatabase(() => settingsRepo.getAll(), {})
    const merged: Record<string, unknown> = {
      hermes_data_dir: config.HERMES_DATA_DIR,
      workspace_root: config.WORKSPACE_ROOT,
      cowork_workspace: config.OPEN_COWORK_WORKSPACE,
      workspace_root_source: isEnvSet('WORKSPACE_ROOT')
        ? 'env'
        : allowDbPathSettings() && typeof all.workspace_root === 'string'
          ? 'settings'
          : 'derived',
      ...all,
    }
    return jsonResponse(maskSettings(merged))
  }

  if (req.method === 'PUT' && parts.length === 2) {
    const unavailable = await requireDatabaseOrResponse()
    if (unavailable) return unavailable
    const body = await parseJson<Record<string, unknown>>(req)
    if (!body) return jsonResponse({ error: 'Invalid JSON' }, 400)
    const { applyWorkspaceRootSetting } = await import('../workspace/root')
    for (const [key, value] of Object.entries(body)) {
      if (typeof value === 'string' && value.startsWith('••••')) continue
      if (key === WORKSPACE_ROOT_SETTING) {
        if (isEnvSet('WORKSPACE_ROOT')) {
          continue
        }
        if (!allowDbPathSettings()) {
          continue
        }
        if (typeof value === 'string' && value.trim()) {
          await settingsRepo.set(key, value.trim())
          await applyWorkspaceRootSetting(value.trim())
        } else {
          await settingsRepo.delete(key)
          await applyWorkspaceRootSetting(null)
        }
        continue
      }
      await settingsRepo.set(key, value)
    }
    const { config } = await import('../config')
    const all = await settingsRepo.getAll()
    return jsonResponse(
      maskSettings({
        hermes_data_dir: config.HERMES_DATA_DIR,
        workspace_root: config.WORKSPACE_ROOT,
        cowork_workspace: config.OPEN_COWORK_WORKSPACE,
        ...all,
      }),
    )
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
