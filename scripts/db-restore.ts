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

async function main() {
  await loadEnv()
  const file = process.argv[2]
  if (!file) {
    console.error('Usage: bun run db:restore <path-to-backup.sql>')
    process.exit(1)
  }
  if (!existsSync(file)) {
    console.error(`Backup file not found: ${file}`)
    process.exit(1)
  }

  console.log(`Restoring from ${file}`)
  const sql = await Bun.file(file).text()
  const proc = Bun.spawn(['docker', 'compose', 'exec', '-T', 'postgres', 'psql', '-U', 'hermes', 'hermes'], {
    cwd: root,
    stdin: new Blob([sql]),
    stdout: 'inherit',
    stderr: 'inherit',
    env: process.env,
  })
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
