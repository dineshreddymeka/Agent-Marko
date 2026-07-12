/**
 * Dev/repo cleanup — reset local build + runtime state.
 *
 * Usage:
 *   bun run scripts/cleanup.ts          # safe: build artifacts, temp dirs, sandbox temp files
 *   bun run scripts/cleanup.ts --db     # also TRUNCATE all app tables (destructive)
 *   bun run scripts/cleanup.ts --all    # everything above
 *   bun run scripts/cleanup.ts --help
 *
 * Never touches the Postgres data volume (HERMES_DATA_DIR/postgres) or the .env file.
 */
import { rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const root = import.meta.dir.replace(/[/\\]scripts$/, '')

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

async function rmPath(rel: string, label = rel): Promise<void> {
  const full = join(root, rel)
  if (!existsSync(full)) return
  await rm(full, { recursive: true, force: true })
  console.log(`  removed ${label}`)
}

const USAGE = `Dev/repo cleanup

Usage:
  bun run scripts/cleanup.ts          Safe: build artifacts, temp dirs, sandbox temp files
  bun run scripts/cleanup.ts --db     Also TRUNCATE all app tables (destructive)
  bun run scripts/cleanup.ts --all    Everything above
  bun run scripts/cleanup.ts --help   Show this help
`

async function truncateDb(): Promise<void> {
  const tables =
    'run_events, messages, memory, skills, mcp_servers, cron_runs, cron_jobs, settings, profiles, sessions'
  console.log('Truncating app tables (destructive)…')
  const proc = Bun.spawn(
    [
      'docker',
      'compose',
      'exec',
      '-T',
      'postgres',
      'psql',
      '-U',
      'hermes',
      '-d',
      'hermes',
      '-c',
      `TRUNCATE TABLE ${tables} RESTART IDENTITY CASCADE`,
    ],
    { cwd: root, stdout: 'inherit', stderr: 'inherit', env: process.env },
  )
  const code = await proc.exited
  if (code !== 0) {
    console.error('DB truncate failed — is `bun run db:up` (docker compose postgres) running?')
    process.exit(1)
  }
  console.log('  app tables truncated')
}

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2))
  if (args.has('--help') || args.has('-h')) {
    console.log(USAGE)
    return
  }
  const all = args.has('--all')
  const withDb = all || args.has('--db')

  await loadEnv()

  console.log('Cleaning build artifacts and temp files…')
  for (const p of [
    'dist',
    'app/dist',
    'server/dist',
    'packages/shared/dist',
    '.tmp',
    '.drizzle',
    'test-results',
    'playwright-report',
    '.lighthouse-report.json',
  ]) {
    await rmPath(p)
  }

  const dataDir = process.env.HERMES_DATA_DIR
  if (dataDir) {
    const sandbox = join(dataDir, 'sandbox')
    if (existsSync(sandbox)) {
      await rm(sandbox, { recursive: true, force: true })
      console.log('  removed sandbox temp files')
    }
  }

  if (withDb) await truncateDb()

  console.log('Cleanup complete.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
