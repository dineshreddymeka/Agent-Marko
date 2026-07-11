import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getSql } from './client'
import { logger } from '../log'

const MIGRATIONS_DIR = join(import.meta.dir, '../../migrations')

export async function runMigrations(): Promise<void> {
  const sql = getSql()
  await sql`
    CREATE TABLE IF NOT EXISTS _hermes_migrations (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `

  const files = ['0001_init.sql']
  for (const file of files) {
    const existing = await sql`
      SELECT 1 AS ok FROM _hermes_migrations WHERE name = ${file} LIMIT 1
    `
    if (existing.length > 0) {
      logger.debug('Migration already applied', { file })
      continue
    }

    const path = join(MIGRATIONS_DIR, file)
    const contents = readFileSync(path, 'utf8')
    logger.info('Applying migration', { file })

    const statements = contents
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && !s.startsWith('--'))

    for (const statement of statements) {
      await sql.unsafe(`${statement};`)
    }

    await sql`INSERT INTO _hermes_migrations (name) VALUES (${file})`
  }

  logger.info('Migrations complete')
}

if (import.meta.main) {
  await runMigrations()
  process.exit(0)
}
