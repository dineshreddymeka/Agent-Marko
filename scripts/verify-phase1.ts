/** Phase 1 acceptance: server health endpoint responds (starts a temp server if needed). */
import { join } from 'node:path'
import { resolveBunExecutable } from './lib/bun-path'

const root = import.meta.dir.replace(/[/\\]scripts$/, '')
const bun = resolveBunExecutable()
const url = process.env.HERMES_HEALTH_URL ?? 'http://127.0.0.1:3001/api/health'

async function waitForHealth(timeoutMs = 20_000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url)
      if (res.ok) {
        const body = (await res.json()) as { ok?: boolean }
        if (body.ok) return
      }
    } catch {
      /* booting */
    }
    await Bun.sleep(400)
  }
  throw new Error(`Health check failed: ${url}`)
}

let serverProc: ReturnType<typeof Bun.spawn> | null = null
try {
  try {
    await waitForHealth(2000)
  } catch {
    console.log('Starting temporary server for Phase 1 health check…')
    serverProc = Bun.spawn([bun, 'src/index.ts'], {
      cwd: join(root, 'server'),
      stdout: 'pipe',
      stderr: 'inherit',
      env: process.env,
    })
    await waitForHealth()
  }

  const res = await fetch(url)
  if (!res.ok) {
    console.error(`Health check failed: ${res.status} ${res.statusText}`)
    process.exit(1)
  }

  const body = (await res.json()) as { ok?: boolean }
  if (!body.ok) {
    console.error('Health check returned ok=false', body)
    process.exit(1)
  }

  console.log('Phase 1 verify: health endpoint OK')
} finally {
  serverProc?.kill()
}
