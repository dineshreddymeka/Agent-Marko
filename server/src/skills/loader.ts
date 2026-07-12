<<<<<<< HEAD
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
=======
/**
 * SKILL.md loader — folder/git sync into Postgres + embedding queue.
 * Author: Dinesh Reddy Meka
 *
 * Sync model:
 * - Disk is source of truth for file-backed skills under SKILLS_DIR
 * - Upsert identity: path → slug → name
 * - content_hash skips re-embed when unchanged
 * - DB rows whose files vanished are marked missing_on_disk (body kept for recreate)
 */
import { access, mkdir, readdir, readFile, rm, unlink, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
>>>>>>> origin/main
import { config } from '../config'
import { isPathInsideRoot } from '../fs/path-jail'
import { skillsRepo } from '../db/repositories/skills'
import { settingsRepo } from '../db/repositories/settings'
import { queueEmbedding } from '../vector/indexer'
import { logger } from '../log'
import { validateGitUrl } from '../security/git-url'
import {
  formatSkillMarkdown,
  inferSkillSource,
  skillContentHash,
  skillFolderSlug,
  skillRelativePath,
  skillSlug,
} from './sync-helpers'
import type { SkillsSyncResult } from '@hermes/shared'

/** Resolve a skill FS path under SKILLS_DIR; throw if it escapes. */
function jailSkillPath(candidate: string): string {
  const root = resolve(config.SKILLS_DIR)
  const abs = resolve(candidate)
  if (!isPathInsideRoot(root, abs)) {
    throw new Error('Skill path escapes SKILLS_DIR')
  }
  return abs
}

/** Safe default path for a skill under SKILLS_DIR. */
function skillDiskPath(slug: string, source: string): string {
  return jailSkillPath(join(config.SKILLS_DIR, skillRelativePath(slug, source)))
}

const log = logger.child({ component: 'skills' })

export type ParsedSkill = {
  name: string
  description: string | null
  bodyMd: string
  triggers: string[] | null
  path: string
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/

function parseFrontmatter(raw: string): ParsedSkill | null {
  const match = raw.match(FRONTMATTER_RE)
  if (!match) return null
  const meta = match[1] ?? ''
  const fields: Record<string, string> = {}
  for (const line of meta.split('\n')) {
    const idx = line.indexOf(':')
    if (idx === -1) continue
    fields[line.slice(0, idx).trim()] = line.slice(idx + 1).trim()
  }
  const name = fields.name
  if (!name) return null
  let triggers: string[] | null = null
  if (fields.triggers) {
    try {
      triggers = JSON.parse(fields.triggers) as string[]
    } catch {
      triggers = fields.triggers.split(',').map((t) => t.trim())
    }
  }
  return {
    name,
    description: fields.description ?? null,
    bodyMd: raw,
    triggers,
    path: '',
  }
}

export function parseSkillMarkdown(content: string, path = ''): ParsedSkill | null {
  const parsed = parseFrontmatter(content)
  if (!parsed) return null
  parsed.path = path
  return parsed
}

export async function findSkillFiles(dir: string): Promise<string[]> {
  const results: string[] = []
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return results
  }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === '.git') continue
      results.push(...(await findSkillFiles(full)))
    } else if (entry.name === 'SKILL.md') {
      results.push(full)
    }
  }
  return results
}

async function upsertSkillFile(
  file: string,
  source: string,
): Promise<'created' | 'updated' | 'unchanged' | 'skipped'> {
  const content = await readFile(file, 'utf8')
  const parsed = parseSkillMarkdown(content, file)
  if (!parsed) return 'skipped'

  const slug = skillFolderSlug(file) || skillSlug(parsed.name)
  const hash = skillContentHash(parsed.bodyMd)
  const { skill, created, contentChanged } = await skillsRepo.upsert({
    name: parsed.name,
    slug,
    description: parsed.description,
    bodyMd: parsed.bodyMd,
    source,
    path: file,
    contentHash: hash,
    triggers: parsed.triggers,
    missingOnDisk: false,
    lastSyncedAt: new Date(),
    skipUnchangedBody: true,
  })

  if (contentChanged) {
    queueEmbedding('skill', skill.id, parsed.bodyMd)
  }

  if (created) return 'created'
  if (contentChanged) return 'updated'
  return 'unchanged'
}

export async function syncSkillsFromDisk(source = 'user-folder'): Promise<SkillsSyncResult> {
  const root = config.SKILLS_DIR
  await mkdir(root, { recursive: true }).catch(() => {})
  const files = await findSkillFiles(root)
  const seenPaths = new Set<string>()

  let created = 0
  let updated = 0
  let unchanged = 0

  for (const file of files) {
    seenPaths.add(file)
    const src = inferSkillSource(file, root, source)
    const result = await upsertSkillFile(file, src)
    if (result === 'created') created++
    else if (result === 'updated') updated++
    else if (result === 'unchanged') unchanged++
  }

  // Mark DB skills whose files disappeared (only those that had a path under SKILLS_DIR)
  const withPaths = await skillsRepo.listWithPaths()
  const orphanIds: string[] = []
  for (const skill of withPaths) {
    if (!skill.path) continue
    if (!isPathInsideRoot(root, skill.path)) continue
    if (!seenPaths.has(skill.path)) {
      try {
        await access(skill.path)
      } catch {
        orphanIds.push(skill.id)
      }
    }
  }
  const missing = await skillsRepo.markMissing(orphanIds)

  const lastSyncedAt = new Date().toISOString()
  await settingsRepo.set('skills_last_synced_at', lastSyncedAt).catch(() => {})

  const synced = created + updated + unchanged
  log.info('Skills synced', { synced, created, updated, unchanged, missing, root })
  return {
    synced,
    created,
    updated,
    unchanged,
    missing,
    recreated: 0,
    lastSyncedAt,
  }
}

/**
 * Clone or pull a git repo into skills/git/<hash> and sync SKILL.md files.
 */
export async function syncSkillsFromGit(repoUrl: string): Promise<{ synced: number; path: string }> {
  const validated = validateGitUrl(repoUrl, { allowSsh: true })
  if (!validated.ok) throw new Error(validated.error)
  const safeUrl = validated.url

  const hash = createHash('sha1').update(safeUrl).digest('hex').slice(0, 12)
  const dest = jailSkillPath(join(config.SKILLS_DIR, 'git', hash))
  await mkdir(join(config.SKILLS_DIR, 'git'), { recursive: true })

  const exists = await readdir(dest)
    .then(() => true)
    .catch(() => false)

  if (exists) {
    const pull = Bun.spawn(['git', '-C', dest, 'pull', '--ff-only', '--'], {
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const code = await pull.exited
    if (code !== 0) {
      const err = await new Response(pull.stderr).text()
      log.warn('git pull failed; recloning', { repoUrl: safeUrl, error: err })
      await rm(dest, { recursive: true, force: true })
    }
  }

  const stillMissing = await readdir(dest)
    .then(() => false)
    .catch(() => true)
  if (stillMissing) {
    const clone = Bun.spawn(['git', 'clone', '--depth', '1', '--', safeUrl, dest], {
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const code = await clone.exited
    if (code !== 0) {
      const errText = await new Response(clone.stderr).text()
      const err = new Error(`git clone failed: ${errText || code}`)
      log.error('git clone failed', { repoUrl: safeUrl, error: err })
      throw err
    }
  }

  const source = `git:${safeUrl}`
  const files = await findSkillFiles(dest)
  let synced = 0
  for (const file of files) {
    const result = await upsertSkillFile(file, source)
    if (result !== 'skipped') synced++
  }
  log.info('Skills synced from git', { repoUrl: safeUrl, synced, dest })
  return { synced, path: dest }
}

/** Write a skill to SKILLS_DIR and upsert DB + queue embedding. */
export async function registerSkill(input: {
  name: string
  bodyMd: string
  description?: string | null
  source?: string
  triggers?: string[] | null
  enabled?: boolean
}): Promise<{ skill: Awaited<ReturnType<typeof skillsRepo.getById>>; path: string }> {
  const name = input.name.trim()
  const source = input.source ?? 'user-folder'
  const slug = skillSlug(name)
  const bodyMd = formatSkillMarkdown({
    name,
    description: input.description,
    body: input.bodyMd,
    triggers: input.triggers,
  })
  const abs = skillDiskPath(slug, source)
  await mkdir(join(abs, '..'), { recursive: true })
  await writeFile(abs, bodyMd, 'utf8')

  const hash = skillContentHash(bodyMd)
  const { skill, contentChanged } = await skillsRepo.upsert({
    name,
    slug,
    description: input.description ?? null,
    bodyMd,
    source,
    path: abs,
    contentHash: hash,
    triggers: input.triggers ?? null,
    enabled: input.enabled ?? true,
    missingOnDisk: false,
    lastSyncedAt: new Date(),
  })
  if (contentChanged) queueEmbedding('skill', skill.id, bodyMd)
  log.info('Skill registered', { name, slug, path: abs, skillId: skill.id })
  return { skill, path: abs }
}

/** Recreate SKILL.md on disk from DB body (for missing_on_disk rows). */
export async function recreateSkillOnDisk(skillId: string): Promise<{ path: string } | null> {
  const skill = await skillsRepo.getById(skillId)
  if (!skill) return null

  const slug = skill.slug || skillSlug(skill.name)
  let abs: string
  if (skill.path && !skill.missingOnDisk) {
    try {
      abs = jailSkillPath(skill.path)
    } catch {
      abs = skillDiskPath(slug, skill.source)
    }
  } else {
    abs = skillDiskPath(slug, skill.source)
  }
  await mkdir(join(abs, '..'), { recursive: true })
  await writeFile(abs, skill.bodyMd, 'utf8')

  await skillsRepo.update(skillId, {
    path: abs,
    missingOnDisk: false,
    lastSyncedAt: new Date(),
    contentHash: skillContentHash(skill.bodyMd),
  })
  queueEmbedding('skill', skill.id, skill.bodyMd)
  log.info('Skill recreated on disk', { skillId, path: abs })
  return { path: abs }
}

/** Persist bodyMd to an existing skill's disk path (or register path). Always under SKILLS_DIR. */
export async function writeSkillBody(skillId: string, bodyMd: string): Promise<string | null> {
  const skill = await skillsRepo.getById(skillId)
  if (!skill) return null
  const slug = skill.slug || skillSlug(skill.name)
  let abs: string
  if (skill.path) {
    try {
      abs = jailSkillPath(skill.path)
    } catch {
      abs = skillDiskPath(slug, skill.source)
    }
  } else {
    abs = skillDiskPath(slug, skill.source)
  }
  await mkdir(join(abs, '..'), { recursive: true })
  await writeFile(abs, bodyMd, 'utf8')
  return abs
}

/** Unlink skill file only when path is inside SKILLS_DIR. */
export async function unlinkSkillFile(skillPath: string | null | undefined): Promise<void> {
  if (!skillPath) return
  try {
    const abs = jailSkillPath(skillPath)
    await unlink(abs)
  } catch {
    // Outside jail or already gone — ignore
  }
}

export { formatSkillMarkdown, skillSlug, skillContentHash }
