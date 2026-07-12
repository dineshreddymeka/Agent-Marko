import { readdirSync, unlinkSync, statSync } from 'node:fs'
import { join } from 'node:path'

const DUMP_RE = /^hermes-.+\.sql$/i

export function parseBackupKeep(raw: string | undefined, fallback = 10): number {
  if (raw === undefined || raw === '') return fallback
  const n = Number.parseInt(raw, 10)
  if (!Number.isFinite(n) || n < 1) return fallback
  return Math.min(n, 10_000)
}

export type BackupEntry = { path: string; mtimeMs: number; name: string }

/** List hermes-*.sql dumps newest-first. */
export function listBackupDumps(dir: string): BackupEntry[] {
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch {
    return []
  }
  const entries: BackupEntry[] = []
  for (const name of names) {
    if (!DUMP_RE.test(name)) continue
    const path = join(dir, name)
    try {
      const st = statSync(path)
      if (!st.isFile()) continue
      entries.push({ path, mtimeMs: st.mtimeMs, name })
    } catch {
      /* skip */
    }
  }
  entries.sort((a, b) => b.mtimeMs - a.mtimeMs || b.name.localeCompare(a.name))
  return entries
}

/**
 * Keep the newest `keep` dumps; delete older hermes-*.sql files.
 * Returns paths that were deleted.
 */
export function pruneBackupDumps(dir: string, keep: number): string[] {
  const limit = Math.max(1, Math.floor(keep))
  const dumps = listBackupDumps(dir)
  if (dumps.length <= limit) return []
  const deleted: string[] = []
  for (const entry of dumps.slice(limit)) {
    try {
      unlinkSync(entry.path)
      deleted.push(entry.path)
    } catch {
      /* leave file if locked */
    }
  }
  return deleted
}
