import type { RunAgentInput } from '@ag-ui/core'
import type { Profile } from '@hermes/shared'
import { isMockLlmEnabled } from './mock-llm'
import { profilesRepo } from '../db/repositories/profiles'
import { sessionsRepo } from '../db/repositories/sessions'
import { memoryRepo } from '../db/repositories/memory'
import { skillsRepo } from '../db/repositories/skills'
import { messagesRepo } from '../db/repositories/messages'
import { embedText } from '../vector/embeddings'
import { config } from '../config'
import { getCronBindings } from '../cron/run-bindings'
import { looksLikeCronIntent } from './tools/a2ui'
import {
  looksLikeDocumentIntent,
  prefersCoworkDocument,
} from './document-intent'
import { looksLikeFormIntent } from './form-intent'
import { looksLikeAguiTroubleshootIntent } from './agui-troubleshoot-intent'
import { buildAguiTroubleshootSteering } from './agui-troubleshoot'

export type BuildAgentContextOptions = {
  /** Pre-fetched AGUI/A2UI troubleshooting brief (only when user explicitly asked). */
  aguiTroubleshootSummary?: string
}

/** Soften legacy profile prompts that still say Hermes. */
function normalizeBrandPrompt(prompt: string): string {
  return prompt
    .replace(/\bI'm Hermes\b/gi, "I'm Open Jarvis")
    .replace(/\bI am Hermes\b/gi, 'I am Open Jarvis')
    .replace(/\bYou are Hermes\b/gi, 'You are Open Jarvis')
    .replace(/\bHermes assistant\b/gi, 'Open Jarvis assistant')
}
import { formatRecallSnippet, searchRecallIndex } from '../indexer/retriever'

export type BuiltContext = {
  systemPrompt: string
  profile: Profile
  memorySnippets: string[]
  skillSnippets: string[]
  transcriptSnippets: string[]
  recallSnippets: string[]
  tokensUsed: number
  budget: number
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

function trimToBudget(items: string[], budget: number): { kept: string[]; used: number } {
  const result: string[] = []
  let used = 0
  for (const item of items) {
    const cost = estimateTokens(item)
    if (used + cost > budget) break
    result.push(item)
    used += cost
  }
  return { kept: result, used }
}

const MOCK_PROFILE: Profile = {
  id: '00000000-0000-4000-8000-000000000099',
  name: 'Mock',
  systemPrompt: 'You are a test agent.',
  model: 'mock',
  temperature: 0,
  provider: 'native',
  providerConfig: null,
  settings: null,
}

export async function buildAgentContext(
  input: RunAgentInput,
  options: BuildAgentContextOptions = {},
): Promise<BuiltContext> {
  const budget = config.CONTEXT_INJECTION_BUDGET

  if (isMockLlmEnabled()) {
    return {
      systemPrompt: MOCK_PROFILE.systemPrompt,
      profile: MOCK_PROFILE,
      memorySnippets: [],
      skillSnippets: [],
      transcriptSnippets: [],
      recallSnippets: [],
      tokensUsed: estimateTokens(MOCK_PROFILE.systemPrompt),
      budget,
    }
  }

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
  const query = lastUser && 'content' in lastUser ? String(lastUser.content ?? '') : ''

  let memorySnippets: string[] = []
  let skillSnippets: string[] = []
  let transcriptSnippets: string[] = []
  let recallSnippets: string[] = []

  // Split injection budget: memory / skills / indexed recall / recent transcript.
  const memBudget = Math.floor(budget / 4)
  const skillBudget = Math.floor(budget / 4)
  const recallBudget = Math.floor(budget / 4)
  const transcriptBudget = budget - memBudget - skillBudget - recallBudget

  if (query) {
    try {
      const embedding = await embedText(query)
      const topK = config.INDEXER_DEFAULT_TOP_K
      const recallPromise = config.INDEXER_ENABLED
        ? Promise.all([
            searchRecallIndex({ query, topK: Math.min(3, topK), sessionId: input.threadId }).catch(
              () => [],
            ),
            searchRecallIndex({
              query,
              topK: Math.min(3, topK),
              sessionId: input.threadId,
              runId: input.runId,
            }).catch(() => []),
            searchRecallIndex({ query, topK: Math.min(5, topK) }).catch(() => []),
          ])
        : Promise.resolve([[], [], []] as const)
      const [memories, skills, ftsMsgs, recallHits] = await Promise.all([
        memoryRepo.vectorSearch(embedding, 5).catch(() => []),
        skillsRepo.vectorSearch(embedding, 3).catch(() => []),
        messagesRepo.ftsSearch(query, 5).catch(() => []),
        recallPromise,
      ])
      memorySnippets = memories.map((m) => `[${m.kind}] ${m.content}`)
      skillSnippets = skills.map((s) => `# Skill: ${s.name}\n${s.bodyMd}`)
      transcriptSnippets = ftsMsgs.map((m) => `[${m.role}] ${m.content.slice(0, 500)}`)
      const [current, byRun, broad] = recallHits
      const seen = new Set<string>()
      recallSnippets = [...byRun, ...current, ...broad]
        .filter((item) => {
          const key = `${item.documentId}:${item.chunkId}`
          if (seen.has(key)) return false
          seen.add(key)
          return true
        })
        .map(formatRecallSnippet)
    } catch {
      const skills = await skillsRepo.search(query, 3).catch(() => [])
      skillSnippets = skills.map((s) => `# Skill: ${s.name}\n${s.bodyMd}`)
    }
  }

  // Recent transcript window (FTS / recency) under remaining budget
  try {
    const recent = await messagesRepo.listBySession?.(input.threadId, 8)
    if (Array.isArray(recent)) {
      transcriptSnippets = recent
        .filter((m: { role: string }) => m.role === 'user' || m.role === 'assistant')
        .map((m: { role: string; content: string }) => `[${m.role}] ${m.content.slice(0, 400)}`)
    } else if (query) {
      const fts = await messagesRepo.ftsSearch(query, 5)
      transcriptSnippets = fts.map((m) => `[${m.role}] ${m.content.slice(0, 400)}`)
    }
  } catch {
    // ignore transcript injection failures
  }

  const mem = trimToBudget(memorySnippets, memBudget)
  const sk = trimToBudget(skillSnippets, skillBudget)
  const rc = trimToBudget(recallSnippets, recallBudget)
  const tr = trimToBudget(transcriptSnippets, transcriptBudget)
  memorySnippets = mem.kept
  skillSnippets = sk.kept
  recallSnippets = rc.kept
  transcriptSnippets = tr.kept

  // Cron workflow bindings: forced skills are always injected (loaded by id,
  // outside the similarity budget) so scheduled runs honor their configuration.
  const bindings = getCronBindings()
  let forcedSkillSnippets: string[] = []
  if (bindings?.skillIds.length) {
    const forced = await Promise.all(
      bindings.skillIds.map((id) => skillsRepo.getById(id).catch(() => null)),
    )
    forcedSkillSnippets = forced
      .filter((s): s is NonNullable<typeof s> => s != null)
      .map((s) => `# Skill: ${s.name}\n${s.bodyMd}`)
    const forcedNames = new Set(forcedSkillSnippets)
    skillSnippets = skillSnippets.filter((s) => !forcedNames.has(s))
  }

  const parts = [normalizeBrandPrompt(profile.systemPrompt)]
  // Soften empty acknowledgments on every turn (small models otherwise reply
  // "What would you like help with?" after a fully specified request).
  parts.push(
    [
      '## Behavior',
      'You are Open Jarvis (not Hermes). Introduce yourself as Open Jarvis when asked.',
      'When the user gives a concrete task, do it or use tools immediately.',
      'Do not ask what they want if they already said it.',
      'Never reply only with vague acknowledgments like "Understood. What would you like help with?" when the request is already specified.',
      'Never narrate internal planning in the reply (no "Preparing to respond", "Drafting a greeting", etc.). Reply with the user-facing answer only.',
    ].join('\n'),
  )
  parts.push(
    [
      '## Internet',
      'Live internet access is on by default via web_search and fetch_url.',
      'For news, scores, prices, docs, "today"/current events, or anything outside your knowledge, prefer web_search then fetch_url on the best hit — do not guess.',
    ].join('\n'),
  )
  parts.push(
    [
      '## Tools & autonomy',
      'You have full agent tools: files, shell, web, memory, indexed search, skills, MCP, A2UI surfaces, Cowork delegation, kanban, and scheduled tasks.',
      'Work like a capable Hermes-style agent: use tools proactively to complete tasks — do not only describe what you would do.',
      'Dangerous tools (shell, writes, delegation) are pre-approved in this environment when needed to finish the job.',
      'Prefer real tool results over guessing.',
    ].join('\n'),
  )
  // Only inject cron steering when the user is actually asking about scheduling.
  // Always-on "## Cron jobs" caused small models to interrogate greetings like "hi".
  if (looksLikeCronIntent(query)) {
    parts.push(
      [
        '## Scheduled tasks (this turn only)',
        'User is asking about cron/scheduled tasks.',
        'Missing/ambiguous details → MUST call cron_form_show (never plain-text Q&A about schedule/timezone/action).',
        'Fully specified name + schedule + prompt → call cron_create directly.',
        'Do not ask for job name/schedule/timezone/action in chat text.',
      ].join('\n'),
    )
  }
  if (looksLikeFormIntent(query)) {
    parts.push(
      [
        '## Forms (this turn only)',
        'User wants a generic interactive form (not a document/PPT, not a cron job).',
        'Missing purpose/fields/submit/storage → MUST call form_request_show.',
        'Never greet again. Never ask "what can I help you with".',
        'Do not treat this as a document or powerpoint request.',
      ].join('\n'),
    )
  }
  if (looksLikeDocumentIntent(query)) {
    const coworkHint = prefersCoworkDocument(query)
      ? 'User asked for PDF/Word/PPT/Office → if details incomplete MUST call document_form_show; if fully specified call delegate_to_cowork (do not only chat).'
      : 'Prefer write_file into the workspace (e.g. drafts/<topic>-draft.md) when topic is clear; if topic/type unclear MUST call document_form_show.'
    parts.push(
      [
        '## Documents / drafts (this turn only)',
        'User wants a document, draft, work file, PPT, or office deliverable.',
        'Missing topic, deliverable type, audience, length, or style → MUST call document_form_show (never plain-text Q&A about Topic/Audience/Length/Style).',
        coworkHint,
        'Put substantive draft content in the reply or the saved file when acting.',
        'Do not invent a topic from filler like "for me".',
      ].join('\n'),
    )
  }
  if (looksLikeAguiTroubleshootIntent(query) && options.aguiTroubleshootSummary) {
    parts.push(buildAguiTroubleshootSteering(options.aguiTroubleshootSummary))
  }
  if (forcedSkillSnippets.length) {
    parts.push('## Required skills\n' + forcedSkillSnippets.join('\n\n'))
  }
  if (memorySnippets.length) {
    parts.push('## Relevant memory\n' + memorySnippets.join('\n\n'))
  }
  if (skillSnippets.length) {
    parts.push('## Matched skills\n' + skillSnippets.join('\n\n'))
  }
  if (recallSnippets.length) {
    parts.push('## Previous context recall\n' + recallSnippets.join('\n\n'))
  }
  if (transcriptSnippets.length) {
    parts.push('## Related transcript\n' + transcriptSnippets.join('\n\n'))
  }

  try {
    const { getResourceMetas, readMcpResource } = await import('../mcp/manager')
    const resources = getResourceMetas().slice(0, 5)
    const resourceSnippets: string[] = []
    let resourceBudget = Math.floor(budget / 6)
    for (const r of resources) {
      try {
        const text = await readMcpResource(r.serverId, r.uri)
        const snippet = `[mcp:${r.serverName} ${r.uri}]\n${text.slice(0, 1500)}`
        const cost = estimateTokens(snippet)
        if (cost > resourceBudget) break
        resourceSnippets.push(snippet)
        resourceBudget -= cost
      } catch {
        // skip unread resources
      }
    }
    if (resourceSnippets.length) {
      parts.push('## MCP resources\n' + resourceSnippets.join('\n\n'))
    }
  } catch {
    // MCP optional during context build
  }

  parts.push(`Workspace root: ${config.WORKSPACE_ROOT}`)

  const systemPrompt = parts.join('\n\n')
  return {
    systemPrompt,
    profile,
    memorySnippets,
    skillSnippets,
    transcriptSnippets,
    recallSnippets,
    tokensUsed: estimateTokens(systemPrompt),
    budget,
  }
}
