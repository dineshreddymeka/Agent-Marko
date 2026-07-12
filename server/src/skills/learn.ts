/**
 * Learning-loop helpers for Open Jarvis skills.
 * Author: Dinesh Reddy Meka
 */
import { registerSkill, formatSkillMarkdown } from './loader'
import { logger } from '../log'

const log = logger.child({ component: 'skills' })

/**
 * Save a learned skill as SKILL.md under skills/learned/<slug>/ and upsert DB + embedding.
 */
export async function saveLearnedSkill(input: {
  name: string
  body: string
  description?: string | null
  triggers?: string[] | null
}): Promise<{ skillId: string; path: string }> {
  const { skill, path } = await registerSkill({
    name: input.name,
    bodyMd: input.body,
    description: input.description,
    triggers: input.triggers,
    source: 'learned',
  })
  if (!skill) throw new Error('Failed to save learned skill')
  log.info('Learned skill saved', { name: input.name, skillId: skill.id, path })
  return { skillId: skill.id, path }
}

export { formatSkillMarkdown }
