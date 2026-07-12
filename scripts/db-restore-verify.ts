/**
 * Post-restore / live DB verify for Open Jarvis (Postgres 17 + pgvector).
 * Asserts vector extension and core tables. Exit 0 on success.
 *
 * Usage: bun run db:restore:verify
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { dockerPathEnv, resolveDocker } from './lib/docker-path'

const root = import.meta.dir.replace(/[/\\]scripts$/, '')

const REQUIRED_TABLES = [
  'sessions',
  'messages',
  'memory',
  'skills',
  'profiles',
  'settings',
  'run_events',
  '_hermes_migrations',
]

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

async function psql(docker: string, sql: string): Promise<{ code: number; out: string }> {
  const proc = Bun.spawn(
    [docker, 'compose', 'exec', '-T', 'postgres', 'psql', '-U', 'hermes', '-d', 'hermes', '-t', '-A', '-c', sql],
    {
      cwd: root,
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env, ...dockerPathEnv() },
    },
  )
  const out = await new Response(proc.stdout).text()
  const err = await new Response(proc.stderr).text()
  const code = await proc.exited
  return { code, out: (out + err).trim() }
}

async function main() {
  await loadEnv()
  const docker = await resolveDocker()
  if (!docker) {
    console.error('Docker not found')
    process.exit(1)
  }

  const ver = await psql(docker, 'SHOW server_version;')
  if (ver.code !== 0) {
    console.error('Cannot query Postgres:', ver.out)
    process.exit(1)
  }
  console.log(`server_version: ${ver.out}`)
  if (!ver.out.startsWith('17')) {
    console.error('Expected Postgres 17.x')
    process.exit(1)
  }

  const ext = await psql(
    docker,
    "SELECT extversion FROM pg_extension WHERE extname = 'vector';",
  )
  if (ext.code !== 0 || !ext.out) {
    console.error('pgvector extension missing — run bun run migrate')
    process.exit(1)
  }
  console.log(`pgvector: ${ext.out}`)

  const tables = await psql(
    docker,
    `SELECT string_agg(tablename, ',' ORDER BY tablename)
     FROM pg_tables WHERE schemaname = 'public';`,
  )
  const present = new Set(
    tables.out
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean),
  )
  const missing = REQUIRED_TABLES.filter((t) => !present.has(t))
  if (missing.length > 0) {
    console.error('Missing tables:', missing.join(', '))
    console.error('Run: bun run migrate (and restore if expected)')
    process.exit(1)
  }

  const counts: string[] = []
  for (const t of ['sessions', 'messages', 'memory', 'skills', 'profiles']) {
    const r = await psql(docker, `SELECT count(*)::text FROM ${t};`)
    counts.push(`${t}=${r.out || '?'}`)
  }
  console.log(`row counts: ${counts.join(' ')}`)
  console.log('db:restore:verify OK (Open Jarvis / Postgres 17 + pgvector)')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
