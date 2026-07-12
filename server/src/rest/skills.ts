import { z } from 'zod'
import { jsonResponse, parseJson } from './helpers'
import { requireDatabaseOrResponse, withDatabase } from './db-guard'
import { config } from '../config'

const createSkillSchema = z.object({
  name: z.string().min(1),
  bodyMd: z.string().min(1),
  description: z.string().nullable().optional(),
  source: z.string().optional(),
  triggers: z.array(z.string()).nullable().optional(),
  enabled: z.boolean().optional(),
  /** When true (default), write SKILL.md under SKILLS_DIR and queue embedding. */
  writeDisk: z.boolean().optional(),
})

const patchSkillSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  bodyMd: z.string().optional(),
  source: z.string().optional(),
  // Client-controlled `path` is intentionally ignored (path jail).
  triggers: z.array(z.string()).nullable().optional(),
  enabled: z.boolean().optional(),
  missingOnDisk: z.boolean().optional(),
})

export async function handleSkills(req: Request, path: string): Promise<Response | null> {
  const { skillsRepo } = await import('../db/repositories/skills')
  const parts = path.split('/').filter(Boolean)

  if (req.method === 'GET' && parts.length === 2) {
    return jsonResponse(await withDatabase(() => skillsRepo.list(), []))
  }

  if (req.method === 'GET' && parts.length === 3 && parts[2] === 'meta') {
    const { settingsRepo } = await import('../db/repositories/settings')
    const lastSyncedAt =
      ((await withDatabase(() => settingsRepo.get('skills_last_synced_at'), null)) as string | null) ??
      null
    const counts = await withDatabase(() => skillsRepo.counts(), {
      total: 0,
      enabled: 0,
      missing: 0,
    })
    return jsonResponse({
      lastSyncedAt,
      skillsDir: config.SKILLS_DIR,
      ...counts,
    })
  }

  if (req.method === 'POST' && parts.length === 3 && parts[2] === 'sync') {
    const unavailable = await requireDatabaseOrResponse()
    if (unavailable) return unavailable
    const body = await parseJson(req).catch(() => null)
    const { syncSkillsFromDisk, syncSkillsFromGit } = await import('../skills/loader')
    const source = body?.source ? String(body.source) : 'user-folder'
    const diskResult = await syncSkillsFromDisk(source)
    let count = diskResult.synced

    const gitUrl = body?.gitUrl ? String(body.gitUrl) : null
    const gitResults: Array<{ url: string; synced: number; error?: string }> = []
    if (gitUrl) {
      const { validateGitUrl } = await import('../security/git-url')
      const validated = validateGitUrl(gitUrl, { allowSsh: true })
      if (!validated.ok) {
        return jsonResponse({ error: validated.error }, 400)
      }
      const result = await syncSkillsFromGit(validated.url)
      count += result.synced
      gitResults.push({ url: validated.url, synced: result.synced })
    } else {
      const { settingsRepo } = await import('../db/repositories/settings')
      const { validateGitUrl } = await import('../security/git-url')
      const sources = ((await settingsRepo.get('skill_git_sources')) as string[] | null) ?? []
      for (const url of sources) {
        const validated = validateGitUrl(url, { allowSsh: true })
        if (!validated.ok) {
          gitResults.push({ url, synced: 0, error: validated.error })
          continue
        }
        try {
          const result = await syncSkillsFromGit(validated.url)
          count += result.synced
          gitResults.push({ url: validated.url, synced: result.synced })
        } catch (err) {
          gitResults.push({ url: validated.url, synced: 0, error: String(err) })
          const { logger } = await import('../log')
          logger.child({ component: 'skills' }).warn('skill git sync failed', { url: validated.url, error: err })
        }
      }
    }
    const { invalidateCapabilityManifest } = await import('../capabilities')
    invalidateCapabilityManifest('skills-sync')
    return jsonResponse({
      ...diskResult,
      synced: count,
      git: gitResults,
    })
  }

  if (req.method === 'POST' && parts.length === 3 && parts[2] === 'sources') {
    const unavailable = await requireDatabaseOrResponse()
    if (unavailable) return unavailable
    const body = await parseJson(req)
    if (!body?.url) return jsonResponse({ error: 'url required' }, 400)
    const { validateGitUrl } = await import('../security/git-url')
    const validated = validateGitUrl(String(body.url), { allowSsh: true })
    if (!validated.ok) return jsonResponse({ error: validated.error }, 400)
    const { settingsRepo } = await import('../db/repositories/settings')
    const existing = ((await settingsRepo.get('skill_git_sources')) as string[] | null) ?? []
    const url = validated.url
    if (!existing.includes(url)) existing.push(url)
    await settingsRepo.set('skill_git_sources', existing)
    return jsonResponse({ sources: existing })
  }

  if (req.method === 'GET' && parts.length === 3 && parts[2] === 'sources') {
    const { settingsRepo } = await import('../db/repositories/settings')
    const sources = ((await settingsRepo.get('skill_git_sources')) as string[] | null) ?? []
    return jsonResponse({ sources })
  }

  if (req.method === 'DELETE' && parts.length === 4 && parts[2] === 'sources') {
    const { settingsRepo } = await import('../db/repositories/settings')
    const url = decodeURIComponent(parts[3]!)
    const existing = ((await settingsRepo.get('skill_git_sources')) as string[] | null) ?? []
    const next = existing.filter((s) => s !== url)
    await settingsRepo.set('skill_git_sources', next)
    return jsonResponse({ sources: next })
  }

  if (req.method === 'POST' && parts.length === 2) {
    const unavailable = await requireDatabaseOrResponse()
    if (unavailable) return unavailable
    const raw = await parseJson(req)
    const parsed = createSkillSchema.safeParse(raw)
    if (!parsed.success) {
      return jsonResponse({ error: 'name and bodyMd required', details: parsed.error.flatten() }, 400)
    }
    const data = parsed.data
    const writeDisk = data.writeDisk !== false
    if (writeDisk) {
      const { registerSkill } = await import('../skills/loader')
      const { skill } = await registerSkill({
        name: data.name,
        bodyMd: data.bodyMd,
        description: data.description,
        source: data.source ?? 'user-folder',
        triggers: data.triggers,
        enabled: data.enabled,
      })
      return jsonResponse(skill, 201)
    }
    const { skillContentHash, skillSlug } = await import('../skills/sync-helpers')
    const { queueEmbedding } = await import('../vector/indexer')
    const { skill } = await skillsRepo.upsert({
      name: data.name,
      slug: skillSlug(data.name),
      description: data.description ?? null,
      bodyMd: data.bodyMd,
      source: data.source ?? 'user-folder',
      contentHash: skillContentHash(data.bodyMd),
      triggers: data.triggers ?? null,
      enabled: data.enabled ?? true,
    })
    queueEmbedding('skill', skill.id, data.bodyMd)
    return jsonResponse(skill, 201)
  }

  if (parts.length === 4 && parts[3] === 'recreate' && req.method === 'POST') {
    const unavailable = await requireDatabaseOrResponse()
    if (unavailable) return unavailable
    const id = parts[2]!
    const { recreateSkillOnDisk } = await import('../skills/loader')
    const result = await recreateSkillOnDisk(id)
    if (!result) return jsonResponse({ error: 'Not found' }, 404)
    const skill = await skillsRepo.getById(id)
    return jsonResponse({ skill, path: result.path })
  }

  if (parts.length === 3) {
    const id = parts[2]!
    if (req.method === 'GET') {
      const skill = await skillsRepo.getById(id)
      if (!skill) return jsonResponse({ error: 'Not found' }, 404)
      return jsonResponse(skill)
    }
    if (req.method === 'PATCH') {
      const unavailable = await requireDatabaseOrResponse()
      if (unavailable) return unavailable
      const raw = await parseJson(req)
      const parsed = patchSkillSchema.safeParse(raw ?? {})
      if (!parsed.success) {
        return jsonResponse({ error: 'Invalid patch', details: parsed.error.flatten() }, 400)
      }
      const body = parsed.data
      const { writeSkillBody } = await import('../skills/loader')
      const { queueEmbedding } = await import('../vector/indexer')
      const { skillContentHash, skillSlug } = await import('../skills/sync-helpers')

      let path: string | undefined
      if (body.bodyMd !== undefined) {
        const written = await writeSkillBody(id, body.bodyMd)
        if (written) path = written
      }

      const skill = await skillsRepo.update(id, {
        name: body.name,
        slug: body.name ? skillSlug(body.name) : undefined,
        description: body.description,
        bodyMd: body.bodyMd,
        source: body.source,
        path: path !== undefined ? path : undefined,
        contentHash: body.bodyMd !== undefined ? skillContentHash(body.bodyMd) : undefined,
        triggers: body.triggers,
        enabled: body.enabled,
        missingOnDisk: body.missingOnDisk ?? (body.bodyMd !== undefined ? false : undefined),
        lastSyncedAt: body.bodyMd !== undefined ? new Date() : undefined,
      })
      if (!skill) return jsonResponse({ error: 'Not found' }, 404)
      if (body.bodyMd !== undefined) queueEmbedding('skill', skill.id, body.bodyMd)
      return jsonResponse(skill)
    }
    if (req.method === 'DELETE') {
      const skill = await skillsRepo.getById(id)
      const deleted = await skillsRepo.delete(id)
      if (deleted && skill?.path) {
        const { unlinkSkillFile } = await import('../skills/loader')
        await unlinkSkillFile(skill.path)
      }
      if (deleted) {
        void import('../indexer/service')
          .then(({ queueRuntimeDelete }) => queueRuntimeDelete('skill', id))
          .catch((err) => {
            void import('../log').then(({ logger }) =>
              logger.warn('Failed to queue skill index delete', { id, error: String(err) }),
            )
          })
      }
      return jsonResponse({ deleted })
    }
  }

  return null
}
