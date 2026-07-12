import { indexerRepo, type IndexSearchFilters, type IndexSearchResult } from '../db/repositories/indexer'
import { tryEmbedQueryLocal } from './local-embeddings'

export type RecallSearchOptions = IndexSearchFilters & {
  query: string
}

export async function searchRecallIndex(options: RecallSearchOptions): Promise<IndexSearchResult[]> {
  const embedding = await tryEmbedQueryLocal(options.query)
  return indexerRepo.search(options.query, embedding, options)
}

export function formatRecallSnippet(result: IndexSearchResult): string {
  const location = result.path
    ? `${result.path}${result.lineStart ? `:${result.lineStart}` : ''}`
    : result.title || result.id
  const session = result.sessionId ? ` session=${result.sessionId}` : ''
  const run = result.runId ? ` run=${result.runId}` : ''
  return `[${result.sourceType}] ${location}${session}${run}\n${result.snippet}`
}
