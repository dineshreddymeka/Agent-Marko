/**
 * Phase 2 acceptance:
 *   docker compose up → migrate → integration tests → /api/health db:true → backup smoke
 *
 * Requires Docker Desktop and HERMES_INTEGRATION_TEST=1 (or pass --integration).
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { resolveBunExecutable } from './lib/bun-path'
import { isDockerDaemonReady, resolveDocker, dockerPathEnv } from './lib/docker-path'

const root = import.meta.dir.replace(/[/\\]scripts$/, '')
const bun = resolveBunExecutable()

async function loadEnv(): Promise<void> {
  const envPath = join(root, '.env')
  if (!existsSync(envPath)) return
  const text = await Bun.file(envPath).text()
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const idx = trimmed.indexOf('=')
    if (idx === -1) continue
    const key = trimmed.slice(0, idx)
    const value = trimmed.slice(idx + 1)
    if (!process.env[key]) process.env[key] = value
  }
}

async function run(cmd: string[], opts?: { cwd?: string; env?: Record<string, string> }): Promise<number> {
  const proc = Bun.spawn(cmd, {
    cwd: opts?.cwd ?? root,
    stdout: 'inherit',
    stderr: 'inherit',
    env: { ...process.env, ...dockerPathEnv(), ...opts?.env },
  })
  return proc.exited
}

async function waitForPostgres(docker: string, timeoutMs = 60_000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const proc = Bun.spawn(
      [docker, 'compose', 'exec', '-T', 'postgres', 'pg_isready', '-U', 'hermes'],
      { cwd: root, stdout: 'pipe', stderr: 'pipe' },
    )
    if ((await proc.exited) === 0) {
      console.log('Postgres is ready')
      return
    }
    await Bun.sleep(2000)
  }
  throw new Error('Postgres did not become ready in time')
}

async function waitForHealth(url: string, timeoutMs = 30_000): Promise<{ db: boolean }> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url)
      if (res.ok) {
        const body = (await res.json()) as { ok?: boolean; db?: boolean }
        if (body.ok && body.db) return { db: true }
      }
    } catch {
      /* server still booting */
    }
    await Bun.sleep(500)
  }
  throw new Error(`Health check failed: ${url} (expected ok:true, db:true)`)
}

async function main() {
  const withIntegration = process.argv.includes('--integration') || process.env.HERMES_INTEGRATION_TEST === '1'
  await loadEnv()

  const docker = await resolveDocker()
  if (!docker) {
    console.error('Docker not found. Install Docker Desktop, then re-run: bun run verify:phase2')
    process.exit(1)
  }

  if (!(await isDockerDaemonReady(docker))) {
    console.error('Docker is installed but the daemon is not running.')
    console.error('Start Docker Desktop (run scripts/setup-docker.ps1 as admin if WSL is broken), then retry.')
    process.exit(1)
  }

  console.log('Step 1/5: docker compose up -d (Postgres 17 + pgvector 0.8.5-pg17)')
  if ((await run([docker, 'compose', 'up', '-d'])) !== 0) {
    console.error(
      'compose up failed. If upgrading from PG17, backup then recreate the data dir — see docs/adr/002-postgres-pgvector.md',
    )
    process.exit(1)
  }

  console.log('Step 2/5: wait for Postgres')
  await waitForPostgres(docker)

  console.log('Step 3/5: migrate')
  const migrateEnv = {
    DATABASE_URL:
      process.env.DATABASE_URL ?? 'postgres://hermes:hermes@localhost:5433/hermes',
  }
  if ((await run([bun, 'run', 'migrate'], { env: migrateEnv })) !== 0) process.exit(1)

  if (withIntegration) {
    console.log('Step 4/5: integration tests (HERMES_INTEGRATION_TEST=1)')
    const code = await run([bun, 'test', 'server/test/db.integration.test.ts'], {
      env: { HERMES_INTEGRATION_TEST: '1' },
    })
    if (code !== 0) process.exit(1)
  } else {
    console.log('Step 4/5: skipped integration tests (pass --integration or set HERMES_INTEGRATION_TEST=1)')
  }

  const healthUrl = process.env.HERMES_HEALTH_URL ?? 'http://127.0.0.1:3001/api/health'
  console.log('Step 5/5: health endpoint with db:true')

  let serverProc: ReturnType<typeof Bun.spawn> | null = null
  try {
    await fetch(healthUrl)
  } catch {
    console.log('Starting temporary server for health check…')
    serverProc = Bun.spawn([bun, 'src/index.ts'], {
      cwd: join(root, 'server'),
      stdout: 'pipe',
      stderr: 'inherit',
      env: process.env,
    })
  }

  try {
    await waitForHealth(healthUrl)
    console.log('Health OK (db:true)')
  } finally {
    serverProc?.kill()
  }

  console.log('Backup smoke test…')
  if ((await run([bun, 'run', 'db:backup'])) !== 0) process.exit(1)

  console.log('Phase 2 verify: complete')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
