import { messagesRepo } from '../db/repositories/messages'
import { memoryRepo } from '../db/repositories/memory'
import { skillsRepo } from '../db/repositories/skills'
import { logger } from '../log'
import { embedText } from './embeddings'

type IndexJob = {
  kind: 'message' | 'memory' | 'skill'
  id: string
  text: string
}

const queue: IndexJob[] = []
let processing = false

export function queueDepth(): number {
  return queue.length
}

export function queueEmbedding(kind: IndexJob['kind'], id: string, text: string): void {
  if (!text.trim()) return
  queue.push({ kind, id, text })
  void import('../indexer/service')
    .then(({ queueRuntimeRecord }) => queueRuntimeRecord(kind, id))
    .catch(() => undefined)
  void drainQueue()
}

async function drainQueue(): Promise<void> {
  if (processing) return
  processing = true
  while (queue.length > 0) {
    const job = queue.shift()!
    try {
      const embedding = await embedText(job.text)
      if (job.kind === 'message') await messagesRepo.setEmbedding(job.id, embedding)
      else if (job.kind === 'memory') await memoryRepo.setEmbedding(job.id, embedding)
      else if (job.kind === 'skill') await skillsRepo.setEmbedding(job.id, embedding)
    } catch (err) {
      logger.warn('Indexer job failed', { kind: job.kind, id: job.id, error: String(err) })
    }
  }
  processing = false
}
