import { mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { dockerPathEnv, resolveDocker } from './lib/docker-path'
import { parseBackupKeep, pruneBackupDumps } from './lib/backup-retention'

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

async function main() {
  await loadEnv()
  const docker = await resolveDocker()
  if (!docker) {
    console.error('Docker not found on PATH. Install Docker Desktop or fix PATH.')
    process.exit(1)
  }

  const backupDir = process.env.HERMES_BACKUP_DIR ?? 'C:/hermes-data/backups'
  const keep = parseBackupKeep(process.env.HERMES_BACKUP_KEEP)
  mkdirSync(backupDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const outfile = join(backupDir, `hermes-${stamp}.sql`)

  console.log(`Backing up to ${outfile}`)
  const proc = Bun.spawn(
    [docker, 'compose', 'exec', '-T', 'postgres', 'pg_dump', '-U', 'hermes', 'hermes'],
    {
      cwd: root,
      stdout: 'pipe',
      stderr: 'inherit',
      env: { ...process.env, ...dockerPathEnv() },
    },
  )
  const sql = await new Response(proc.stdout).text()
  await Bun.write(outfile, sql)
  const code = await proc.exited
  if (code !== 0) {
    console.error('pg_dump failed — is docker compose postgres running?')
    process.exit(1)
  }

  const pruned = pruneBackupDumps(backupDir, keep)
  if (pruned.length > 0) {
    console.log(`Retention: kept last ${keep}; removed ${pruned.length} older dump(s)`)
  }
  console.log('Backup complete')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
