import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { config } from '../config'
import { skillsRepo } from '../db/repositories/skills'
import { queueEmbedding } from '../vector/indexer'
import { logger } from '../log'

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

async function findSkillFiles(dir: string): Promise<string[]> {
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
      results.push(...(await findSkillFiles(full)))
    } else if (entry.name === 'SKILL.md') {
      results.push(full)
    }
  }
  return results
}

export async function syncSkillsFromDisk(source = 'user-folder'): Promise<number> {
  const root = config.SKILLS_DIR
  const files = await findSkillFiles(root)
  let count = 0
  for (const file of files) {
    const content = await readFile(file, 'utf8')
    const parsed = parseSkillMarkdown(content, file)
    if (!parsed) continue
    const skill = await skillsRepo.upsert({
      name: parsed.name,
      description: parsed.description,
      bodyMd: parsed.bodyMd,
      source,
      path: file,
      triggers: parsed.triggers,
    })
    queueEmbedding('skill', skill.id, parsed.bodyMd)
    count++
  }
  logger.info('Skills synced', { count, root })
  return count
}
