import { readFile, stat } from 'node:fs/promises'
import { isAbsolute, join, normalize, resolve, sep } from 'node:path'

/** Parsed `outbox/<taskId>/status.json` schema (v1, §14). */
export type CoworkStatus = {
  taskId: string
  ok: boolean
  files: string[]
  summary?: string
  warnings?: string[]
  error?: string
  verified?: boolean
  startedAt?: string
  finishedAt?: string
  [key: string]: unknown
}

export type StatusValidationOk = {
  ok: true
  status: CoworkStatus
  /** Absolute paths to deliverables that passed checks. */
  resolvedFiles: string[]
}

export type StatusValidationFail = {
  ok: false
  error: string
  status?: CoworkStatus | null
  resolvedFiles?: string[]
}

export type StatusValidationResult = StatusValidationOk | StatusValidationFail

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Reject path traversal / absolute paths in status.files entries. */
function resolveOutboxFile(outboxTaskDir: string, relativeFile: string): string | null {
  if (!relativeFile || typeof relativeFile !== 'string') return null
  const trimmed = relativeFile.trim()
  if (!trimmed || isAbsolute(trimmed) || trimmed.includes('\0')) return null
  // Normalize separators; block .. segments
  const normalized = normalize(trimmed).replace(/^[\\/]+/, '')
  if (normalized.startsWith('..') || normalized.split(/[/\\]/).includes('..')) return null

  const full = resolve(outboxTaskDir, normalized)
  const root = resolve(outboxTaskDir)
  const prefix = root.endsWith(sep) ? root : root + sep
  if (full !== root && !full.startsWith(prefix)) return null
  return full
}

/**
 * Validate `outbox/<taskId>/status.json` per §9 / §14.
 * - Must exist and parse
 * - Required: taskId, ok, files[]
 * - taskId must match expectedTaskId
 * - When ok===true, every files[] entry must exist under outbox/<taskId>/ and be non-empty
 * - When ok===false, missing files are reported but do not change the structural parse
 */
export async function validateStatus(
  workspaceRoot: string,
  expectedTaskId: string,
): Promise<StatusValidationResult> {
  const outboxTaskDir = join(workspaceRoot, 'outbox', expectedTaskId)
  const statusPath = join(outboxTaskDir, 'status.json')

  let raw: string
  try {
    raw = await readFile(statusPath, 'utf8')
  } catch {
    return { ok: false, error: `status.json missing at outbox/${expectedTaskId}/status.json` }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ok: false, error: 'status.json is not valid JSON' }
  }

  if (!isPlainObject(parsed)) {
    return { ok: false, error: 'status.json must be a JSON object', status: null }
  }

  if (!isNonEmptyString(parsed.taskId)) {
    return { ok: false, error: 'status.json missing required string field: taskId', status: null }
  }
  if (typeof parsed.ok !== 'boolean') {
    return { ok: false, error: 'status.json missing required boolean field: ok', status: null }
  }
  if (!Array.isArray(parsed.files) || !parsed.files.every((f) => typeof f === 'string')) {
    return {
      ok: false,
      error: 'status.json missing required string[] field: files',
      status: null,
    }
  }

  const status = parsed as CoworkStatus

  if (status.taskId !== expectedTaskId) {
    return {
      ok: false,
      error: `status.json taskId mismatch: expected ${expectedTaskId}, got ${status.taskId}`,
      status,
    }
  }

  const resolvedFiles: string[] = []
  const missing: string[] = []
  const empty: string[] = []
  const unsafe: string[] = []

  for (const file of status.files) {
    const full = resolveOutboxFile(outboxTaskDir, file)
    if (!full) {
      unsafe.push(file)
      continue
    }
    try {
      const st = await stat(full)
      if (!st.isFile()) {
        missing.push(file)
        continue
      }
      if (st.size === 0) {
        empty.push(file)
        continue
      }
      resolvedFiles.push(full)
    } catch {
      missing.push(file)
    }
  }

  if (unsafe.length > 0) {
    return {
      ok: false,
      error: `status.json files contain unsafe paths: ${unsafe.join(', ')}`,
      status,
      resolvedFiles,
    }
  }

  if (missing.length > 0) {
    return {
      ok: false,
      error: `status.json files missing on disk: ${missing.join(', ')}`,
      status,
      resolvedFiles,
    }
  }

  if (empty.length > 0) {
    return {
      ok: false,
      error: `status.json files are empty: ${empty.join(', ')}`,
      status,
      resolvedFiles,
    }
  }

  if (!status.ok) {
    const errMsg =
      typeof status.error === 'string' && status.error
        ? status.error
        : 'status.json reports ok:false'
    return { ok: false, error: errMsg, status, resolvedFiles }
  }

  return { ok: true, status, resolvedFiles }
}
