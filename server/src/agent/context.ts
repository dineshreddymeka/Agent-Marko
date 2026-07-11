import type { RunAgentInput } from '@ag-ui/core'
import type { Profile } from '@hermes/shared'
import { profilesRepo } from '../db/repositories/profiles'
import { sessionsRepo } from '../db/repositories/sessions'
import { memoryRepo } from '../db/repositories/memory'
import { skillsRepo } from '../db/repositories/skills'
import { embedText } from '../vector/embeddings'
import { config } from '../config'

export type BuiltContext = {
  systemPrompt: string
  profile: Profile
  memorySnippets: string[]
  skillSnippets: string[]
}

const TOKEN_BUDGET = 8000

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

function trimToBudget(items: string[], budget: number): string[] {
  const result: string[] = []
  let used = 0
  for (const item of items) {
    const cost = estimateTokens(item)
    if (used + cost > budget) break
    result.push(item)
    used += cost
  }
  return result
}

export async function buildAgentContext(input: RunAgentInput): Promise<BuiltContext> {
  const session = await sessionsRepo.getById(input.threadId)
  let profile: Profile | null = null
  if (session?.profileId) {
    profile = await profilesRepo.getById(session.profileId)
  }
  if (!profile) {
    profile = await profilesRepo.getDefault()
  }
  if (!profile) {
    throw new Error('No profile available')
  }

  const lastUser = [...input.messages].reverse().find((m) => m.role === 'user')
  const query = lastUser && 'content' in lastUser ? lastUser.content : ''

  let memorySnippets: string[] = []
  let skillSnippets: string[] = []

  if (query) {
    try {
      const embedding = await embedText(query)
      const memories = await memoryRepo.vectorSearch(embedding, 5)
      memorySnippets = memories.map((m) => `[${m.kind}] ${m.content}`)
      const skills = await skillsRepo.vectorSearch(embedding, 3)
      skillSnippets = skills.map((s) => `# Skill: ${s.name}\n${s.bodyMd}`)
    } catch {
      const skills = await skillsRepo.search(query, 3)
      skillSnippets = skills.map((s) => `# Skill: ${s.name}\n${s.bodyMd}`)
    }
  }

  memorySnippets = trimToBudget(memorySnippets, TOKEN_BUDGET / 3)
  skillSnippets = trimToBudget(skillSnippets, TOKEN_BUDGET / 3)

  const parts = [profile.systemPrompt]
  if (memorySnippets.length) {
    parts.push('## Relevant memory\n' + memorySnippets.join('\n\n'))
  }
  if (skillSnippets.length) {
    parts.push('## Matched skills\n' + skillSnippets.join('\n\n'))
  }
  parts.push(`Workspace root: ${config.WORKSPACE_ROOT}`)

  return {
    systemPrompt: parts.join('\n\n'),
    profile,
    memorySnippets,
    skillSnippets,
  }
}
