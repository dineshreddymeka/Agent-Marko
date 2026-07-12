import { registerTool } from './registry'
import { saveLearnedSkill } from '../../skills/learn'
import { skillsRepo } from '../../db/repositories/skills'

registerTool({
  name: 'skill_save',
  description: 'Save a learned skill as SKILL.md under skills/learned/',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      description: { type: 'string' },
      body: { type: 'string' },
      triggers: { type: 'array', items: { type: 'string' } },
    },
    required: ['name', 'body'],
  },
  async execute(args) {
    return saveLearnedSkill({
      name: String(args.name),
      body: String(args.body),
      description: args.description ? String(args.description) : null,
      triggers: Array.isArray(args.triggers) ? args.triggers.map(String) : null,
    })
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
