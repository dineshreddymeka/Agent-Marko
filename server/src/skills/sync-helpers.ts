/**
 * Pure helpers for skills slug/hash/source — unit-testable without DB/disk.
 * Author: Dinesh Reddy Meka
 */
import { createHash } from 'node:crypto'
import { basename, dirname, join, sep } from 'node:path'

/** Normalize a skill name or folder into a stable slug. */
export function skillSlug(name: string): string {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return base || 'skill'
}

/** SHA-256 hex of SKILL.md body (used for sync change detection). */
export function skillContentHash(bodyMd: string): string {
  return createHash('sha256').update(bodyMd, 'utf8').digest('hex')
}

/**
 * Infer source from a path under SKILLS_DIR.
 * `learned/` → learned, `git/` → git:local (or caller override), else user-folder/builtin.
 */
export function inferSkillSource(
  filePath: string,
  skillsRoot: string,
  defaultSource = 'user-folder',
): string {
  const normalized = filePath.replace(/\\/g, '/')
  const root = skillsRoot.replace(/\\/g, '/')
  const rel = normalized.startsWith(root) ? normalized.slice(root.length).replace(/^\//, '') : normalized
  if (rel.includes('/learned/') || rel.startsWith('learned/')) return 'learned'
  if (rel.includes('/git/') || rel.startsWith('git/')) {
    return defaultSource.startsWith('git:') ? defaultSource : 'git:local'
  }
  if (rel.includes('/builtin/') || rel.startsWith('builtin/')) return 'builtin'
  return defaultSource
}

/** Folder name for a skill file (`…/<slug>/SKILL.md` → slug). */
export function skillFolderSlug(filePath: string): string {
  return skillSlug(basename(dirname(filePath)))
}

/** Build canonical SKILL.md with frontmatter. */
export function formatSkillMarkdown(opts: {
  name: string
  description?: string | null
  body: string
  triggers?: string[] | null
}): string {
  const triggersLine = opts.triggers?.length ? `\ntriggers: ${JSON.stringify(opts.triggers)}` : ''
  const body = opts.body.replace(/^\uFEFF/, '')
  if (/^---\r?\n/.test(body)) {
    let next = body
    if (/^name:/m.test(next)) {
      next = next.replace(/^name:.*$/m, `name: ${opts.name}`)
    }
    if (opts.description != null && /^description:/m.test(next)) {
      next = next.replace(/^description:.*$/m, `description: ${opts.description}`)
    }
    return next
  }
  return `---\nname: ${opts.name}\ndescription: ${opts.description ?? ''}${triggersLine}\n---\n\n${body}\n`
}

/** Relative path under skills root: `<slug>/SKILL.md` or `learned/<slug>/SKILL.md`. */
export function skillRelativePath(slug: string, source: string): string {
  if (source === 'learned') return join('learned', slug, 'SKILL.md')
  if (source === 'builtin') return join('builtin', slug, 'SKILL.md')
  return join(slug, 'SKILL.md')
}

export function joinSkillsPath(skillsRoot: string, ...parts: string[]): string {
  return join(skillsRoot, ...parts)
}

/** Platform-agnostic path segment check used by tests. */
export function pathContainsSegment(filePath: string, segment: string): boolean {
  const parts = filePath.split(/[/\\]/)
  return parts.includes(segment)
}

export { dirname, basename, sep }
