import { existsSync } from 'node:fs'
import { join } from 'node:path'

/** Resolve the Bun executable (Windows installs often omit `bun` from PATH). */
export function resolveBunExecutable(): string {
  if (process.execPath.toLowerCase().includes('bun')) {
    return process.execPath
  }

  const bunBin = process.platform === 'win32' ? 'bun.exe' : 'bun'

  if (process.env.BUN_INSTALL) {
    const candidate = join(process.env.BUN_INSTALL, 'bin', bunBin)
    if (existsSync(candidate)) return candidate
  }

  if (process.platform === 'win32') {
    const local = join(process.env.USERPROFILE ?? '', '.bun', 'bin', 'bun.exe')
    if (existsSync(local)) return local
  } else {
    const home = process.env.HOME ?? ''
    const local = join(home, '.bun', 'bin', 'bun')
    if (existsSync(local)) return local
  }

  return 'bun'
}
