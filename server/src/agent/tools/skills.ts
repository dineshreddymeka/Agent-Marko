import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { config } from '../../config'
import { skillsRepo } from '../../db/repositories/skills'
import { queueEmbedding } from '../../vector/indexer'
import { registerTool } from './registry'

registerTool({
  name: 'skill_save',
  description: 'Save a learned skill as SKILL.md',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      description: { type: 'string' },
      body: { type: 'string' },
    },
    required: ['name', 'body'],
  },
  async execute(args) {
    const name = String(args.name)
    const body = String(args.body)
    const description = args.description ? String(args.description) : null
    const dir = join(config.SKILLS_DIR, 'learned', name)
    await mkdir(dir, { recursive: true })
    const md = `---\nname: ${name}\ndescription: ${description ?? ''}\n---\n\n${body}\n`
    await writeFile(join(dir, 'SKILL.md'), md, 'utf8')
    const skill = await skillsRepo.upsert({
      name,
      description,
      bodyMd: md,
      source: 'learned',
      path: dir,
    })
    queueEmbedding('skill', skill.id, md)
    return skill
  },
})

registerTool({
  name: 'skill_search',
  description: 'Search skills by query',
  parameters: {
    type: 'object',
    properties: { query: { type: 'string' } },
    required: ['query'],
  },
  async execute(args) {
    return skillsRepo.search(String(args.query), 10)
  },
})
