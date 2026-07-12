/**
 * Read-only preflight checks before applying 0006_integrity_fixes.sql.
 * Prints actionable findings; exits 1 if any blocker rows are found.
 *
 * Usage: bun run db:preflight
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { SQL } from 'bun'

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

type Check = {
  name: string
  blocker: boolean
  sql: string
}

const CHECKS: Check[] = [
  {
    name: 'sessions.profile_id orphans',
    blocker: true,
    sql: `SELECT s.id::text AS id, s.profile_id::text AS ref
FROM sessions s
LEFT JOIN profiles p ON p.id = s.profile_id
WHERE s.profile_id IS NOT NULL AND p.id IS NULL`,
  },
  {
    name: 'cron_jobs.profile_id orphans',
    blocker: true,
    sql: `SELECT c.id::text AS id, c.profile_id::text AS ref
FROM cron_jobs c
LEFT JOIN profiles p ON p.id = c.profile_id
WHERE c.profile_id IS NOT NULL AND p.id IS NULL`,
  },
  {
    name: 'memory.source_session orphans',
    blocker: true,
    sql: `SELECT m.id::text AS id, m.source_session::text AS ref
FROM memory m
LEFT JOIN sessions s ON s.id = m.source_session
WHERE m.source_session IS NOT NULL AND s.id IS NULL`,
  },
  {
    name: 'cron_runs.session_id orphans',
    blocker: true,
    sql: `SELECT cr.id::text AS id, cr.session_id::text AS ref
FROM cron_runs cr
LEFT JOIN sessions s ON s.id = cr.session_id
WHERE cr.session_id IS NOT NULL AND s.id IS NULL`,
  },
  {
    name: 'run_events.session_id orphans',
    blocker: true,
    sql: `SELECT re.id::text AS id, re.session_id::text AS ref
FROM run_events re
LEFT JOIN sessions s ON s.id = re.session_id
WHERE re.session_id IS NOT NULL AND s.id IS NULL`,
  },
  {
    name: 'duplicate profiles.name (deferred UNIQUE — informational)',
    blocker: false,
    sql: `SELECT name AS id, count(*)::text AS ref
FROM profiles
GROUP BY name
HAVING count(*) > 1`,
  },
  {
    name: 'duplicate cron_jobs.name (deferred UNIQUE — informational)',
    blocker: false,
    sql: `SELECT name AS id, count(*)::text AS ref
FROM cron_jobs
GROUP BY name
HAVING count(*) > 1`,
  },
  {
    name: 'invalid messages.role',
    blocker: true,
    sql: `SELECT role AS id, count(*)::text AS ref
FROM messages
GROUP BY role
HAVING role NOT IN ('user', 'assistant', 'system', 'tool')`,
  },
  {
    name: 'invalid cron_runs.status',
    blocker: true,
    sql: `SELECT status AS id, count(*)::text AS ref
FROM cron_runs
GROUP BY status
HAVING status NOT IN ('running', 'completed', 'failed')`,
  },
  {
    name: 'invalid mcp_servers.transport',
    blocker: true,
    sql: `SELECT transport AS id, count(*)::text AS ref
FROM mcp_servers
GROUP BY transport
HAVING transport NOT IN ('stdio', 'http')`,
  },
  {
    name: 'duplicate run_events (run_id, seq)',
    blocker: true,
    sql: `SELECT run_id::text AS id, seq::text AS ref
FROM (
  SELECT run_id, seq, count(*) AS c
  FROM run_events
  GROUP BY run_id, seq
  HAVING count(*) > 1
) d`,
  },
  {
    name: 'stale cron_jobs.mcp_server_ids (informational — app cleanup)',
    blocker: false,
    sql: `SELECT j.id::text AS id, x.server_id::text AS ref
FROM cron_jobs j
CROSS JOIN LATERAL unnest(j.mcp_server_ids) AS x(server_id)
LEFT JOIN mcp_servers s ON s.id = x.server_id
WHERE s.id IS NULL`,
  },
  {
    name: 'stale cron_jobs.skill_ids (informational — app cleanup)',
    blocker: false,
    sql: `SELECT j.id::text AS id, x.skill_id::text AS ref
FROM cron_jobs j
CROSS JOIN LATERAL unnest(j.skill_ids) AS x(skill_id)
LEFT JOIN skills s ON s.id = x.skill_id
WHERE s.id IS NULL`,
  },
]

async function main() {
  await loadEnv()
  const url = process.env.DATABASE_URL
  if (!url) {
    console.error('DATABASE_URL is not set. Copy .env.example or export it first.')
    process.exit(1)
  }

  const sql = new SQL(url, { max: 1 })
  let blockers = 0
  let warnings = 0

  console.log('Open Jarvis DB preflight (read-only) — integrity checks for 0006\n')

  try {
    await sql`SELECT 1 AS ok`
  } catch (err) {
    console.error('Cannot connect to Postgres:', err instanceof Error ? err.message : err)
    process.exit(1)
  }

  for (const check of CHECKS) {
    let rows: Array<{ id: string; ref: string }>
    try {
      rows = (await sql.unsafe(check.sql)) as Array<{ id: string; ref: string }>
    } catch (err) {
      console.error(`FAIL  ${check.name}`)
      console.error(`      query error: ${err instanceof Error ? err.message : err}`)
      blockers++
      continue
    }

    if (rows.length === 0) {
      console.log(`OK    ${check.name}`)
      continue
    }

    const label = check.blocker ? 'BLOCK' : 'WARN'
    if (check.blocker) blockers++
    else warnings++

    console.log(`${label}  ${check.name} (${rows.length} row(s))`)
    for (const row of rows.slice(0, 10)) {
      console.log(`      ${row.id} -> ${row.ref}`)
    }
    if (rows.length > 10) {
      console.log(`      … and ${rows.length - 10} more`)
    }
  }

  console.log('')
  if (blockers > 0) {
    console.error(
      `Preflight found ${blockers} blocker check(s)` +
        (warnings ? ` and ${warnings} warning(s)` : '') +
        '. 0006 pre-cleans orphans, but invalid roles/statuses/transports and duplicate run_events must be fixed first.',
    )
    process.exit(1)
  }

  if (warnings > 0) {
    console.log(
      `Preflight OK for 0006 constraints (${warnings} informational warning(s) — deferred UNIQUE / binding cleanup).`,
    )
  } else {
    console.log('Preflight OK — safe to apply 0006_integrity_fixes.sql.')
  }
  process.exit(0)
}

await main()
