import { messagesRepo } from '../db/repositories/messages'
import { memoryRepo } from '../db/repositories/memory'
import { skillsRepo } from '../db/repositories/skills'
import { embedText } from './embeddings'

export type SearchResult = {
  kind:
    | 'message'
    | 'memory'
    | 'skill'
    | 'session'
    | 'workspace_file'
    | 'cron_job'
    | 'run_event'
    | 'cowork_task'
    | 'office_artifact'
  id: string
  snippet: string
  score?: number
  sessionId?: string
  runId?: string | null
  userId?: string | null
  actionId?: string | null
  documentId?: string
  chunkId?: string
  path?: string | null
  title?: string | null
  lineStart?: number | null
  lineEnd?: number | null
  sourceType?: string
}

export async function hybridSearch(query: string, limit = 20): Promise<SearchResult[]> {
  const results: SearchResult[] = []

  const ftsMessages = await messagesRepo.ftsSearch(query, limit)
  for (const m of ftsMessages) {
    results.push({
      kind: 'message',
      id: m.id,
      snippet: m.content.slice(0, 200),
      sessionId: m.sessionId,
    })
  }

  try {
    const embedding = await embedText(query)
    const [memories, skills] = await Promise.all([
      memoryRepo.vectorSearch(embedding, Math.ceil(limit / 2)),
      skillsRepo.vectorSearch(embedding, Math.ceil(limit / 2)),
    ])
    for (const m of memories) {
      results.push({ kind: 'memory', id: m.id, snippet: m.content.slice(0, 200) })
    }
    for (const s of skills) {
      results.push({ kind: 'skill', id: s.id, snippet: s.description ?? s.name })
    }
  } catch {
    // degrade to FTS-only
  }

  return results.slice(0, limit)
}
