/**
 * Admin bootstrap: create non-superuser `hermes_app` role for runtime pools.
 * Not a normal app migration — requires a privileged DATABASE_ADMIN_URL (or
 * DATABASE_URL as the bootstrap superuser) and HERMES_APP_PASSWORD.
 *
 * Usage:
 *   HERMES_APP_PASSWORD=... bun run db:create-app-role
 *
 * Idempotent: re-runs refresh grants and (when password is set) rotate the
 * role password. Does not drop or recreate the role.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { SQL } from 'bun'

const root = import.meta.dir.replace(/[/\\]scripts$/, '')
const DEFAULT_ROLE = 'hermes_app'
const DEFAULT_DB = 'hermes'

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

function databaseNameFromUrl(url: string): string {
  try {
    const u = new URL(url)
    const name = u.pathname.replace(/^\//, '').split('?')[0]
    return name || DEFAULT_DB
  } catch {
    return DEFAULT_DB
  }
}

function assertSafeIdent(name: string, label: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(name)) {
    throw new Error(`${label} must be a simple SQL identifier (got ${JSON.stringify(name)})`)
  }
  return name
}

async function main() {
  await loadEnv()

  const adminUrl = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL
  if (!adminUrl) {
    console.error(
      'Set DATABASE_ADMIN_URL (preferred) or DATABASE_URL to a privileged Postgres URL.',
    )
    process.exit(1)
  }

  const password = process.env.HERMES_APP_PASSWORD
  if (!password) {
    console.error('Set HERMES_APP_PASSWORD to the login password for hermes_app.')
    process.exit(1)
  }

  const role = assertSafeIdent(process.env.HERMES_APP_ROLE ?? DEFAULT_ROLE, 'HERMES_APP_ROLE')
  const dbName = assertSafeIdent(
    process.env.HERMES_APP_DATABASE ?? databaseNameFromUrl(adminUrl),
    'database name',
  )

  const sql = new SQL(adminUrl, { max: 1 })

  try {
    const existing = await sql`
      SELECT 1 AS ok FROM pg_roles WHERE rolname = ${role}
    `
    const created = existing.length === 0

    if (created) {
      const [{ ddl }] = await sql`
        SELECT format(
          'CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE',
          ${role}::text,
          ${password}::text
        ) AS ddl
      `
      await sql.unsafe(ddl as string)
      console.log(`Created role ${role} (LOGIN NOSUPERUSER)`)
    } else {
      const [{ ddl }] = await sql`
        SELECT format('ALTER ROLE %I PASSWORD %L', ${role}::text, ${password}::text) AS ddl
      `
      await sql.unsafe(ddl as string)
      console.log(`Role ${role} already exists — password updated`)
    }

    // CONNECT is database-scoped; identifier already validated.
    await sql.unsafe(`GRANT CONNECT ON DATABASE ${dbName} TO ${role}`)
    await sql.unsafe(`GRANT USAGE ON SCHEMA public TO ${role}`)
    await sql.unsafe(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${role}`,
    )
    await sql.unsafe(
      `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${role}`,
    )
    // Future objects created by this admin/migrator role.
    await sql.unsafe(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${role}`,
    )
    await sql.unsafe(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ${role}`,
    )

    console.log(`Granted CONNECT on database ${dbName}`)
    console.log('Granted USAGE on schema public')
    console.log('Granted DML on existing public tables + USAGE/SELECT on sequences')
    console.log('Set ALTER DEFAULT PRIVILEGES for future tables/sequences')
    console.log('')
    console.log('Next steps (operator):')
    console.log(`  1. Point app DATABASE_URL at ${role}, e.g.`)
    console.log(
      `     DATABASE_URL=postgres://${role}:<password>@localhost:5433/${dbName}`,
    )
    console.log('  2. Keep DATABASE_ADMIN_URL as the privileged migrator URL (hermes).')
    console.log('  3. Run migrations with DATABASE_ADMIN_URL / admin credentials, not hermes_app.')
    console.log('  4. Consider HERMES_DB_POOL_MAX=4 or 5 in local .env.')
    if (created) {
      console.log(`Done — role ${role} created and granted.`)
    } else {
      console.log(`Done — role ${role} grants refreshed (idempotent re-run).`)
    }
  } finally {
    await sql.close()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
