import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { dockerPathEnv, resolveDocker } from './lib/docker-path'

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

function parseArgs(argv: string[]): { dryRun: boolean; latest: boolean; file: string | undefined } {
  const flags = new Set(argv.filter((a) => a.startsWith('--')))
  const positional = argv.filter((a) => !a.startsWith('--'))
  return {
    dryRun: flags.has('--dry-run') || flags.has('--verify'),
    latest: flags.has('--latest'),
    file: positional[0],
  }
}

function findLatestBackup(): string {
  const backupDir = process.env.HERMES_BACKUP_DIR ?? 'C:/hermes-data/backups'
  if (!existsSync(backupDir)) {
    console.error(`No backup directory found: ${backupDir}`)
    process.exit(1)
  }
  const dumps = readdirSync(backupDir)
    .filter((f) => f.startsWith('hermes-') && f.endsWith('.sql'))
    .sort()
  if (dumps.length === 0) {
    console.error(`No backups found in ${backupDir}`)
    process.exit(1)
  }
  return join(backupDir, dumps[dumps.length - 1]!)
}

function summarizeDump(sql: string): {
  bytes: number
  createTables: number
  inserts: number
  looksLikeDump: boolean
} {
  const createTables = (sql.match(/CREATE TABLE/gi) ?? []).length
  const inserts = (sql.match(/\bINSERT INTO\b/gi) ?? []).length
  const looksLikeDump =
    sql.includes('PostgreSQL database dump') ||
    createTables > 0 ||
    /CREATE EXTENSION/i.test(sql) ||
    inserts > 0
  return { bytes: Buffer.byteLength(sql, 'utf8'), createTables, inserts, looksLikeDump }
}

async function main() {
  await loadEnv()
  const { dryRun, latest, file: rawFile } = parseArgs(process.argv.slice(2))
  const file = latest ? findLatestBackup() : rawFile
  if (!file) {
    console.error('Usage: bun run db:restore [--dry-run|--verify] [--latest | <path-to-backup.sql>]')
    process.exit(1)
  }
  if (!existsSync(file)) {
    console.error(`Backup file not found: ${file}`)
    process.exit(1)
  }

  const sql = await Bun.file(file).text()
  const summary = summarizeDump(sql)
  if (sql.trim().length === 0) {
    console.error('Backup file is empty')
    process.exit(1)
  }
  if (!summary.looksLikeDump) {
    console.error('File does not look like a pg_dump SQL dump')
    process.exit(1)
  }

  if (dryRun) {
    console.log('Restore dry-run / verify OK')
    console.log(`  file: ${file}`)
    console.log(`  bytes: ${summary.bytes}`)
    console.log(`  CREATE TABLE ≈ ${summary.createTables}`)
    console.log(`  INSERT INTO ≈ ${summary.inserts}`)
    process.exit(0)
  }

  const docker = await resolveDocker()
  if (!docker) {
    console.error('Docker not found on PATH. Install Docker Desktop or fix PATH.')
    process.exit(1)
  }

  console.log(`Restoring from ${file}`)
  const proc = Bun.spawn(
    [docker, 'compose', 'exec', '-T', 'postgres', 'psql', '-U', 'hermes', 'hermes'],
    {
      cwd: root,
      stdin: new Blob([sql]),
      stdout: 'inherit',
      stderr: 'inherit',
      env: { ...process.env, ...dockerPathEnv() },
    },
  )
  const code = await proc.exited
  if (code !== 0) {
    console.error('Restore failed')
    process.exit(1)
  }
  console.log('Restore complete')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
