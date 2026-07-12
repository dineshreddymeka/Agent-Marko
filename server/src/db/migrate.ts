import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getSql } from './client'
import { logger } from '../log'

export const MIGRATIONS_DIR = join(import.meta.dir, '../../migrations')

function stripLeadingComments(chunk: string): string {
  return chunk
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .trim()
}

export { stripLeadingComments }

/**
 * Split a PostgreSQL migration script into executable statements.
 *
 * Supported subset:
 * - `;` terminators outside quotes/comments
 * - Single-quoted literals (`'...'`) with `''` escapes
 * - Double-quoted identifiers (`"..."`) with `""` escapes
 * - Dollar-quoted bodies (`$$...$$`, `$tag$...$tag$`)
 * - Line comments (`-- ...`) and C-style block comments
 *
 * Not supported: COPY FROM stdin, nested dollar-tag edge cases beyond
 * standard open/close matching, and statements that cannot run inside a
 * transaction (e.g. CREATE INDEX CONCURRENTLY, VACUUM).
 */
export function splitPostgresStatements(sqlText: string): string[] {
  const statements: string[] = []
  let current = ''
  let i = 0
  const n = sqlText.length

  const flush = () => {
    const trimmed = stripLeadingComments(current.trim())
    if (trimmed.length > 0) statements.push(trimmed)
    current = ''
  }

  while (i < n) {
    const c = sqlText[i]!

    // Line comment — consume through newline (semicolon inside is not a terminator).
    if (c === '-' && sqlText[i + 1] === '-') {
      const end = sqlText.indexOf('\n', i)
      if (end === -1) {
        current += sqlText.slice(i)
        i = n
      } else {
        current += sqlText.slice(i, end + 1)
        i = end + 1
      }
      continue
    }

    // Block comment
    if (c === '/' && sqlText[i + 1] === '*') {
      const end = sqlText.indexOf('*/', i + 2)
      if (end === -1) {
        current += sqlText.slice(i)
        i = n
      } else {
        current += sqlText.slice(i, end + 2)
        i = end + 2
      }
      continue
    }

    // Single-quoted string literal
    if (c === "'") {
      current += c
      i++
      while (i < n) {
        if (sqlText[i] === "'" && sqlText[i + 1] === "'") {
          current += "''"
          i += 2
          continue
        }
        current += sqlText[i]!
        if (sqlText[i] === "'") {
          i++
          break
        }
        i++
      }
      continue
    }

    // Double-quoted identifier
    if (c === '"') {
      current += c
      i++
      while (i < n) {
        if (sqlText[i] === '"' && sqlText[i + 1] === '"') {
          current += '""'
          i += 2
          continue
        }
        current += sqlText[i]!
        if (sqlText[i] === '"') {
          i++
          break
        }
        i++
      }
      continue
    }

    // Dollar-quoted string: $$...$$ or $tag$...$tag$
    if (c === '$') {
      const tagMatch = sqlText.slice(i).match(/^\$([A-Za-z_][A-Za-z0-9_]*)?\$/)
      if (tagMatch) {
        const tag = tagMatch[0]!
        current += tag
        i += tag.length
        const close = sqlText.indexOf(tag, i)
        if (close === -1) {
          current += sqlText.slice(i)
          i = n
        } else {
          current += sqlText.slice(i, close + tag.length)
          i = close + tag.length
        }
        continue
      }
    }

    if (c === ';') {
      flush()
      i++
      continue
    }

    current += c
    i++
  }

  flush()
  return statements
}

/** Minimal executor surface for unit-testing apply + ledger ordering. */
export type MigrationTx = {
  unsafe: (query: string) => Promise<unknown>
  insertLedger: (name: string) => Promise<void>
}

/**
 * Run migration statements then insert the ledger row.
 * Callers must wrap this in a DB transaction so a mid-file failure rolls back
 * both DDL and the ledger insert together.
 */
export async function applyMigrationWithLedger(
  tx: MigrationTx,
  file: string,
  statements: string[],
): Promise<void> {
  for (const statement of statements) {
    await tx.unsafe(`${statement};`)
  }
  await tx.insertLedger(file)
}

function listMigrationFiles(dir = MIGRATIONS_DIR): string[] {
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith('.sql'))
      .sort()
  } catch {
    return dir === MIGRATIONS_DIR ? ['0001_init.sql'] : []
  }
}

/** Exported for unit tests — sorted `.sql` basenames in the migrations dir. */
export function discoverMigrationFiles(dir = MIGRATIONS_DIR): string[] {
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith('.sql'))
      .sort()
  } catch {
    return []
  }
}

export async function runMigrations(): Promise<void> {
  const sql = getSql()
  await sql`
    CREATE TABLE IF NOT EXISTS _hermes_migrations (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `

  const files = listMigrationFiles()
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

    const statements = splitPostgresStatements(contents)

    // DDL + ledger row commit together; any statement failure rolls both back.
    await sql.begin(async (tx) => {
      await applyMigrationWithLedger(
        {
          unsafe: (query) => tx.unsafe(query),
          insertLedger: async (name) => {
            await tx`INSERT INTO _hermes_migrations (name) VALUES (${name})`
          },
        },
        file,
        statements,
      )
    })
  }

  logger.info('Migrations complete')
}

if (import.meta.main) {
  await runMigrations()
  process.exit(0)
}
