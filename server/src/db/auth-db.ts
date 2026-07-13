import { getSql } from './client'

/** better-auth tables (LDAP / OAuth sessions). Distinct from app chat `sessions`. */
export const AUTH_TABLES = ['user', 'session', 'account', 'verification'] as const

export type AuthTableName = (typeof AUTH_TABLES)[number]

export type AuthDbStatus = {
  ok: boolean
  tables: Record<AuthTableName, boolean>
  missing: AuthTableName[]
}

/** Verify migration 0015 auth tables exist (fleet LDAP requires this). */
export async function verifyAuthTables(): Promise<AuthDbStatus> {
  const sql = getSql()
  const rows = (await sql`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN ('user', 'session', 'account', 'verification')
  `) as { table_name: string }[]

  const found = new Set(rows.map((r) => r.table_name))
  const tables = Object.fromEntries(
    AUTH_TABLES.map((name) => [name, found.has(name)]),
  ) as Record<AuthTableName, boolean>
  const missing = AUTH_TABLES.filter((name) => !tables[name])

  return { ok: missing.length === 0, tables, missing }
}

export type AuthDbCounts = {
  users: number
  authSessions: number
  accounts: number
}

/** Row estimates for debug health (never throws). */
export async function getAuthDbCounts(): Promise<AuthDbCounts | null> {
  try {
    const sql = getSql()
    const [users] = await sql`SELECT count(*)::int AS n FROM "user"`
    const [authSessions] = await sql`SELECT count(*)::int AS n FROM session`
    const [accounts] = await sql`SELECT count(*)::int AS n FROM account`
    return {
      users: Number((users as { n: number }).n) || 0,
      authSessions: Number((authSessions as { n: number }).n) || 0,
      accounts: Number((accounts as { n: number }).n) || 0,
    }
  } catch {
    return null
  }
}
