import { config } from '../config'
import { VectorError } from '../errors'
import { logger } from '../log'

const BATCH_SIZE = 64

export async function embedText(text: string): Promise<number[]> {
  const results = await embedBatch([text])
  return results[0] ?? []
}

export async function embedBatch(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return []
  const url = `${config.LLM_BASE_URL.replace(/\/$/, '')}/embeddings`
  const all: number[][] = []

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE)
    let lastErr: unknown
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: config.LLM_API_KEY ? `Bearer ${config.LLM_API_KEY}` : '',
          },
          body: JSON.stringify({
            model: config.EMBEDDINGS_MODEL,
            input: batch,
          }),
        })
        if (!res.ok) {
          throw new VectorError(`Embeddings failed (${res.status}): ${await res.text()}`)
        }
        const json = (await res.json()) as {
          data: Array<{ embedding: number[]; index: number }>
        }
        const sorted = [...json.data].sort((a, b) => a.index - b.index)
        all.push(...sorted.map((d) => d.embedding))
        break
      } catch (err) {
        lastErr = err
        await Bun.sleep(250 * (attempt + 1))
      }
    }
    if (all.length < i + batch.length) {
      logger.warn('Embedding batch failed', { error: String(lastErr) })
      throw lastErr instanceof Error ? lastErr : new VectorError(String(lastErr))
    }
  }

  return all
}
