export type TextChunk = {
  chunkIndex: number
  content: string
  tokenEstimate: number
  lineStart: number
  lineEnd: number
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

export function chunkText(text: string, opts?: { maxChars?: number; overlapChars?: number }): TextChunk[] {
  const maxChars = Math.max(256, opts?.maxChars ?? 1800)
  const overlapChars = Math.max(0, Math.min(opts?.overlapChars ?? 200, Math.floor(maxChars / 2)))
  const normalized = text.replace(/\r\n/g, '\n')
  if (!normalized.trim()) return []

  const lineStarts: number[] = [0]
  for (let i = 0; i < normalized.length; i++) {
    if (normalized[i] === '\n') lineStarts.push(i + 1)
  }

  const lineForOffset = (offset: number): number => {
    let line = 0
    for (let i = 0; i < lineStarts.length; i++) {
      if (lineStarts[i]! > offset) break
      line = i
    }
    return line + 1
  }

  const chunks: TextChunk[] = []
  let start = 0
  while (start < normalized.length) {
    let end = Math.min(start + maxChars, normalized.length)
    if (end < normalized.length) {
      const newline = normalized.lastIndexOf('\n', end)
      if (newline > start + Math.floor(maxChars * 0.5)) end = newline + 1
    }
    const content = normalized.slice(start, end).trim()
    if (content) {
      chunks.push({
        chunkIndex: chunks.length,
        content,
        tokenEstimate: estimateTokens(content),
        lineStart: lineForOffset(start),
        lineEnd: lineForOffset(Math.max(start, end - 1)),
      })
    }
    if (end >= normalized.length) break
    start = Math.max(end - overlapChars, start + 1)
  }
  return chunks
}
