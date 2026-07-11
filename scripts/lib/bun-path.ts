import { existsSync } from 'node:fs'
import { join } from 'node:path'

/** Resolve the Bun executable (Windows installs often omit `bun` from PATH). */
export function resolveBunExecutable(): string {
  if (process.execPath.toLowerCase().includes('bun')) {
    return process.execPath
  }

  if (process.env.BUN_INSTALL) {
    const candidate = join(process.env.BUN_INSTALL, 'bin', 'bun.exe')
    if (existsSync(candidate)) return candidate
  }

  const local = join(process.env.USERPROFILE ?? '', '.bun', 'bin', 'bun.exe')
  if (existsSync(local)) return local

  return 'bun'
}
