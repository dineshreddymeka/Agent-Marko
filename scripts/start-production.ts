/**
 * Production entry — single port, built UI + API (fleet hosts).
 * Supervises the server process: Bun 1.3.x on Windows can panic
 * ("integer overflow"); on abnormal exit we respawn with backoff.
 * Dev continues to use `bun run dev` (Vite :5173 + API :3001).
 */
import { existsSync, readFileSync } from 'node:fs'
import { spawn } from 'node:child_process'

const root = import.meta.dir.replace(/[/\\]scripts$/, '')
const distIndex = `${root}/app/dist/index.html`

const MAX_RESTARTS_PER_HOUR = 60
const BACKOFF_BASE_MS = 1_000
const BACKOFF_MAX_MS = 30_000

function loadRootEnv(): Record<string, string> {
  const out: Record<string, string> = {
    HERMES_SERVE_STATIC: '1',
  }
  try {
    const text = readFileSync(`${root}/.env`, 'utf8')
    for (const line of text.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eq = trimmed.indexOf('=')
      if (eq <= 0) continue
      const key = trimmed.slice(0, eq).trim()
      let value = trimmed.slice(eq + 1).trim()
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1)
      }
      out[key] = value
    }
  } catch {
    // optional
  }
  return out
}

if (!existsSync(distIndex)) {
  console.error('Missing app build — run `bun run build` first')
  process.exit(1)
}

const bunExe = process.execPath.toLowerCase().includes('bun')
  ? process.execPath
  : process.platform === 'win32'
    ? `${process.env.USERPROFILE ?? ''}/.bun/bin/bun.exe`
    : 'bun'

const env = { ...process.env, ...loadRootEnv(), FORCE_COLOR: '1' }

let shuttingDown = false
let restarts: number[] = []
let child: ReturnType<typeof spawn> | null = null

function spawnServer(): void {
  child = spawn(bunExe, ['src/index.ts'], {
    cwd: `${root}/server`,
    stdio: 'inherit',
    env,
  })

  child.on('exit', (code, signal) => {
    if (shuttingDown) process.exit(code ?? 0)
    if (code === 0) process.exit(0)

    const now = Date.now()
    restarts = restarts.filter((t) => now - t < 3_600_000)
    if (restarts.length >= MAX_RESTARTS_PER_HOUR) {
      console.error(
        `[supervisor] ${restarts.length} restarts in the last hour — giving up. Last exit: code=${code} signal=${signal}`,
      )
      process.exit(code ?? 1)
    }
    restarts.push(now)

    const delay = Math.min(BACKOFF_BASE_MS * 2 ** Math.min(restarts.length - 1, 5), BACKOFF_MAX_MS)
    console.error(
      `[supervisor] server exited (code=${code} signal=${signal}) — restarting in ${delay}ms (restart #${restarts.length} this hour)`,
    )
    setTimeout(spawnServer, delay)
  })
}

function shutdown(sig: NodeJS.Signals): void {
  shuttingDown = true
  child?.kill(sig)
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))

spawnServer()
