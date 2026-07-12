import type { CoworkEvent } from './types'

export type JsonlParseOk = { ok: true; value: CoworkEvent }
export type JsonlParseSkip = { ok: false; reason: 'blank' | 'malformed'; line: string }

export type JsonlParseResult = JsonlParseOk | JsonlParseSkip

/**
 * Parse a single JSONL line.
 * Blank/whitespace-only → skip. Malformed JSON → skip (caller should log).
 */
export function parseJsonlLine(line: string): JsonlParseResult {
  const trimmed = line.trim()
  if (!trimmed) return { ok: false, reason: 'blank', line }
  try {
    const value = JSON.parse(trimmed) as unknown
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return { ok: false, reason: 'malformed', line: trimmed }
    }
    const obj = value as Record<string, unknown>
    if (typeof obj.type !== 'string') {
      return { ok: false, reason: 'malformed', line: trimmed }
    }
    return { ok: true, value: obj as CoworkEvent }
  } catch {
    return { ok: false, reason: 'malformed', line: trimmed }
  }
}

/**
 * Buffer incomplete chunks until newline-delimited lines are complete.
 * Does not interpret JSON — only splits on `\n` / `\r\n`.
 */
export class JsonlLineBuffer {
  private buf = ''

  /** Push a utf8 chunk; returns complete lines (without trailing newline). */
  push(chunk: string): string[] {
    this.buf += chunk
    const lines: string[] = []
    for (;;) {
      const nl = this.buf.indexOf('\n')
      if (nl < 0) break
      let line = this.buf.slice(0, nl)
      this.buf = this.buf.slice(nl + 1)
      if (line.endsWith('\r')) line = line.slice(0, -1)
      lines.push(line)
    }
    return lines
  }

  /** Remaining unterminated data (may be empty). */
  remainder(): string {
    return this.buf
  }

  /** Clear buffer and return any leftover (for EOF flush). */
  flush(): string {
    const left = this.buf
    this.buf = ''
    return left
  }
}
