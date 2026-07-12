import { SQL } from 'bun'
import { drizzle } from 'drizzle-orm/bun-sql'
import { config } from '../config'
import { logger } from '../log'
import { DbError } from '../errors'
import { schema } from './schema'

type HermesDbGlobals = typeof globalThis & {
  __hermesSql?: SQL
  __hermesDb?: ReturnType<typeof drizzle<typeof schema>>
}

const g = globalThis as HermesDbGlobals

/**
 * Reuse the Bun.sql pool across `--hot` reloads.
 * Without this, each hot reload creates a new pool and exhausts Postgres
 * max_connections (compose default 50), which then 500s message/session reads.
 */
export function getSql(): SQL {
  if (!g.__hermesSql) {
    g.__hermesSql = new SQL(config.DATABASE_URL, {
      max: config.HERMES_DB_POOL_MAX,
      // Release idle sockets so leaked/abandoned pools drain faster under load.
      idleTimeout: 20,
      maxLifetime: 1800,
    })
  }
  return g.__hermesSql
}

export function getDb() {
  if (!g.__hermesDb) {
    g.__hermesDb = drizzle({ client: getSql(), schema })
  }
  return g.__hermesDb
}

/** Close the shared pool (tests / graceful shutdown). */
export async function closeSql(opts?: { timeout?: number }): Promise<void> {
  const sql = g.__hermesSql
  g.__hermesSql = undefined
  g.__hermesDb = undefined
  if (!sql) return
  try {
    await sql.close({ timeout: opts?.timeout ?? 5 })
  } catch (err) {
    logger.debug('closeSql failed', { error: String(err) })
  }
}

let lastPingFailLog = 0
const PING_FAIL_LOG_INTERVAL_MS = 60_000

export async function pingDatabase(): Promise<boolean> {
  try {
    const sql = getSql()
    await sql`SELECT 1 AS ok`
    return true
  } catch (err) {
    const now = Date.now()
    if (now - lastPingFailLog >= PING_FAIL_LOG_INTERVAL_MS) {
      lastPingFailLog = now
      logger.warn('Database unreachable (will retry)', { error: String(err) })
    }
    return false
  }
}

export async function requireDatabase(): Promise<void> {
  const ok = await pingDatabase()
  if (!ok) {
    throw new DbError(
      'Postgres is unreachable. Start with `bun run db:up` and check DATABASE_URL.',
    )
  }
}

export type DbMetrics = {
  version: string
  poolMax: number
  tables: Record<string, number>
}

/** Lightweight counts for /api/debug/health — best-effort, never throws. */
export async function getDbMetrics(): Promise<DbMetrics | null> {
  try {
    const sql = getSql()
    const [ver] = await sql`SELECT version() AS version`
    const rows = await sql`
      SELECT c.relname AS name, c.reltuples::bigint AS estimate
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind = 'r'
        AND c.relname IN (
          'sessions', 'messages', 'memory', 'skills',
          'profiles', 'cron_jobs', 'run_events', 'settings'
        )
      ORDER BY c.relname
    `
    const tables: Record<string, number> = {}
    for (const row of rows as { name: string; estimate: number | string }[]) {
      tables[row.name] = Number(row.estimate) || 0
    }
    return {
      version: String((ver as { version?: string })?.version ?? ''),
      poolMax: config.HERMES_DB_POOL_MAX,
      tables,
    }
  } catch (err) {
    logger.debug('getDbMetrics failed', { error: String(err) })
    return null
  }
}

export { schema }
