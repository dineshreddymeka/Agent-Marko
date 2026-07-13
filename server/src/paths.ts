import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'

/** Monorepo root (`hermes-ui/`). */
export function repoRoot(): string {
  return resolve(import.meta.dir, '../..')
}

export function isEnvSet(key: string): boolean {
  const v = process.env[key]
  return typeof v === 'string' && v.trim().length > 0
}

/**
 * Default data directory when `HERMES_DATA_DIR` is unset.
 * Installers should set `HERMES_DATA_DIR` per host; this is a safe fallback only.
 */
export function defaultHermesDataDir(): string {
  if (process.platform === 'win32') return 'C:/hermes-data'
  if (process.platform === 'darwin') return join(homedir(), '.hermes', 'data')
  return '/var/lib/hermes'
}

/** Resolve `HERMES_DATA_DIR` (absolute or relative to repo root). */
export function resolveHermesDataDir(raw: string | undefined): string {
  const trimmed = (raw ?? '').trim()
  if (!trimmed) return defaultHermesDataDir()
  if (isAbsolute(trimmed)) return trimmed
  return resolve(repoRoot(), trimmed)
}

/**
 * Agent workspace for drafts/uploads.
 * Precedence at runtime: explicit `WORKSPACE_ROOT` env → `${dataDir}/workspace`.
 */
export function resolveWorkspaceRoot(
  raw: string | undefined,
  dataDir: string,
): string {
  const trimmed = (raw ?? '').trim()
  if (trimmed) {
    if (isAbsolute(trimmed)) return trimmed
    return resolve(repoRoot(), trimmed)
  }
  return join(dataDir, 'workspace')
}

/** Open Cowork inbox/outbox root. */
export function resolveCoworkWorkspace(
  raw: string | undefined,
  dataDir: string,
): string {
  const trimmed = (raw ?? '').trim()
  if (trimmed) {
    if (isAbsolute(trimmed)) return trimmed
    return resolve(repoRoot(), trimmed)
  }
  return join(dataDir, 'cowork-workspace')
}

export function resolveBackupDir(raw: string | undefined, dataDir: string): string {
  const trimmed = (raw ?? '').trim()
  if (trimmed) {
    if (isAbsolute(trimmed)) return trimmed
    return resolve(dataDir, trimmed)
  }
  return join(dataDir, 'backups')
}

/** Whether UI/DB may override env-derived path defaults (off for fleet installs). */
export function allowDbPathSettings(): boolean {
  const v = (process.env.HERMES_ALLOW_DB_PATH_SETTINGS ?? '1').trim().toLowerCase()
  return !['0', 'false', 'no', 'off'].includes(v)
}
