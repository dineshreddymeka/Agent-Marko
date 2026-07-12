import { config } from '../config'
import { logger } from '../log'
import { embedBatch, embedText } from '../vector/embeddings'

function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return null
  }
}

function isLocalHost(host: string | null): boolean {
  if (!host) return false
  return (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host.endsWith('.local') ||
    host.startsWith('192.168.') ||
    host.startsWith('10.') ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
  )
}

/** Prefer dedicated embeddings URL, then agent LLM, then LLM_BASE_URL. */
export function embeddingEndpointUrl(): string {
  return (
    config.HERMES_EMBEDDINGS_URL?.trim() ||
    config.HERMES_AGENT_LLM_URL?.trim() ||
    config.LLM_BASE_URL ||
    ''
  )
}

export function isLocalEmbeddingEndpoint(): boolean {
  return isLocalHost(hostnameOf(embeddingEndpointUrl()))
}

export async function embedBatchLocal(texts: string[]): Promise<number[][]> {
  if (!isLocalEmbeddingEndpoint()) {
    throw new Error(
      `Indexer embeddings require a local embeddings endpoint, got ${embeddingEndpointUrl() || '(empty)'}`,
    )
  }
  return embedBatch(texts)
}

export async function tryEmbedQueryLocal(query: string): Promise<number[] | null> {
  if (!query.trim() || !isLocalEmbeddingEndpoint()) return null
  try {
    return await embedText(query)
  } catch (err) {
    logger.warn('Local query embedding failed; falling back to Postgres FTS', { error: String(err) })
    return null
  }
}
