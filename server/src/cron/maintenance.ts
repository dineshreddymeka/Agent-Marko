/**
 * Deterministic maintenance runners for system cron jobs.
 * DB consistency + bug-bounty hygiene — check then auto-fix every schedule tick.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { config } from '../config'
import { getSql } from '../db/client'
import { cronRepo } from '../db/repositories/cron'
import { mcpServersRepo } from '../db/repositories/mcp_servers'
import { runEventsRepo } from '../db/repositories/run_events'
import { logger } from '../log'
import type { CronSystemKind } from '@hermes/shared'

export type MaintenanceResult = {
  kind: CronSystemKind
  ok: boolean
  checked: number
  fixed: number
  findings: string[]
  detail: Record<string, unknown>
}

const REPO_ROOT = resolve(import.meta.dir, '../../..')

/** Stuck cron_runs older than this are marked failed. */
const STUCK_RUN_MINUTES = 15

async function countUnsafe(sql: ReturnType<typeof getSql>, query: string): Promise<number> {
  try {
    const rows = (await sql.unsafe(query)) as Array<{ c?: number | string }>
    const n = rows[0]?.c
    return typeof n === 'number' ? n : Number(n ?? 0)
  } catch {
    return 0
  }
}

async function execUnsafe(sql: ReturnType<typeof getSql>, query: string): Promise<number> {
  try {
    const result = await sql.unsafe(query)
    if (Array.isArray(result)) return result.length
    const affected = (result as { count?: number })?.count
    return typeof affected === 'number' ? affected : 0
  } catch (err) {
    logger.warn('Maintenance SQL failed', { error: String(err), query: query.slice(0, 120) })
    return 0
  }
}

async function cleanupStaleCronBindings(): Promise<{ checked: number; fixed: number; findings: string[] }> {
  const findings: string[] = []
  let fixed = 0
  const jobs = await cronRepo.listJobs()
  let checked = 0
  const sql = getSql()

  for (const job of jobs) {
    if (job.mcpServerIds.length === 0 && job.skillIds.length === 0) continue

    const liveMcp = new Set<string>()
    const liveSkills = new Set<string>()
    if (job.mcpServerIds.length) {
      const rows = (await sql`
        SELECT id::text AS id FROM mcp_servers WHERE id IN ${sql(job.mcpServerIds)}
      `) as Array<{ id: string }>
      for (const r of rows) liveMcp.add(r.id)
    }
    if (job.skillIds.length) {
      const rows = (await sql`
        SELECT id::text AS id FROM skills WHERE id IN ${sql(job.skillIds)}
      `) as Array<{ id: string }>
      for (const r of rows) liveSkills.add(r.id)
    }

    const mcpServerIds = job.mcpServerIds.filter((id) => liveMcp.has(id))
    const skillIds = job.skillIds.filter((id) => liveSkills.has(id))
    const droppedMcp = job.mcpServerIds.length - mcpServerIds.length
    const droppedSkills = job.skillIds.length - skillIds.length
    checked += droppedMcp + droppedSkills
    if (droppedMcp === 0 && droppedSkills === 0) continue

    await cronRepo.updateJob(job.id, {
      mcpServerIds,
      skillIds,
      workflow: {
        ...job.workflow,
        mcpServerIds,
        skillIds,
      },
    })
    fixed += 1
    findings.push(
      `cron job "${job.name}": removed ${droppedMcp} stale MCP + ${droppedSkills} stale skill binding(s)`,
    )
  }

  return { checked, fixed, findings }
}

export async function runDbConsistencyMaintenance(): Promise<MaintenanceResult> {
  const sql = getSql()
  const findings: string[] = []
  let checked = 0
  let fixed = 0

  const orphanFixes: Array<{ name: string; countSql: string; fixSql: string }> = [
    {
      name: 'sessions.profile_id orphans',
      countSql: `SELECT count(*)::int AS c FROM sessions s
LEFT JOIN profiles p ON p.id = s.profile_id
WHERE s.profile_id IS NOT NULL AND p.id IS NULL`,
      fixSql: `UPDATE sessions s SET profile_id = NULL
WHERE profile_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM profiles p WHERE p.id = s.profile_id)`,
    },
    {
      name: 'cron_jobs.profile_id orphans',
      countSql: `SELECT count(*)::int AS c FROM cron_jobs c
LEFT JOIN profiles p ON p.id = c.profile_id
WHERE c.profile_id IS NOT NULL AND p.id IS NULL`,
      fixSql: `UPDATE cron_jobs c SET profile_id = NULL
WHERE profile_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM profiles p WHERE p.id = c.profile_id)`,
    },
    {
      name: 'memory.source_session orphans',
      countSql: `SELECT count(*)::int AS c FROM memory m
LEFT JOIN sessions s ON s.id = m.source_session
WHERE m.source_session IS NOT NULL AND s.id IS NULL`,
      fixSql: `UPDATE memory m SET source_session = NULL
WHERE source_session IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM sessions s WHERE s.id = m.source_session)`,
    },
    {
      name: 'cron_runs.session_id orphans',
      countSql: `SELECT count(*)::int AS c FROM cron_runs cr
LEFT JOIN sessions s ON s.id = cr.session_id
WHERE cr.session_id IS NOT NULL AND s.id IS NULL`,
      fixSql: `UPDATE cron_runs cr SET session_id = NULL
WHERE session_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM sessions s WHERE s.id = cr.session_id)`,
    },
    {
      name: 'run_events.session_id orphans',
      countSql: `SELECT count(*)::int AS c FROM run_events re
LEFT JOIN sessions s ON s.id = re.session_id
WHERE re.session_id IS NOT NULL AND s.id IS NULL`,
      fixSql: `UPDATE run_events re SET session_id = NULL
WHERE session_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM sessions s WHERE s.id = re.session_id)`,
    },
  ]

  for (const step of orphanFixes) {
    const before = await countUnsafe(sql, step.countSql)
    checked += 1
    if (before <= 0) continue
    await execUnsafe(sql, step.fixSql)
    const after = await countUnsafe(sql, step.countSql)
    const repaired = Math.max(0, before - after)
    fixed += repaired
    findings.push(`${step.name}: fixed ${repaired} row(s)`)
  }

  // Stuck running cron runs → failed
  const stuckBefore = await countUnsafe(
    sql,
    `SELECT count(*)::int AS c FROM cron_runs
WHERE status = 'running' AND started_at < NOW() - INTERVAL '${STUCK_RUN_MINUTES} minutes'`,
  )
  checked += 1
  if (stuckBefore > 0) {
    await execUnsafe(
      sql,
      `UPDATE cron_runs
SET status = 'failed',
    error = COALESCE(error, 'Marked failed by DB consistency maintenance (stuck running)'),
    finished_at = NOW()
WHERE status = 'running' AND started_at < NOW() - INTERVAL '${STUCK_RUN_MINUTES} minutes'`,
    )
    fixed += stuckBefore
    findings.push(`stuck cron_runs: marked ${stuckBefore} failed`)
  }

  const bindings = await cleanupStaleCronBindings()
  checked += bindings.checked
  fixed += bindings.fixed
  findings.push(...bindings.findings)

  // Retention prune (safe; keeps recent rows)
  try {
    const prunedEvents = await runEventsRepo.pruneOlderThan(config.HERMES_EVENT_RETENTION_DAYS)
    checked += 1
    if (prunedEvents > 0) {
      fixed += prunedEvents
      findings.push(`run_events prune: removed ${prunedEvents} row(s) older than ${config.HERMES_EVENT_RETENTION_DAYS}d`)
    }
  } catch (err) {
    findings.push(`run_events prune skipped: ${String(err)}`)
  }
  try {
    const prunedMcp = await mcpServersRepo.pruneConnectionEventsOlderThan(
      config.HERMES_MCP_EVENT_RETENTION_DAYS,
    )
    checked += 1
    if (prunedMcp > 0) {
      fixed += prunedMcp
      findings.push(
        `mcp_connection_events prune: removed ${prunedMcp} row(s) older than ${config.HERMES_MCP_EVENT_RETENTION_DAYS}d`,
      )
    }
  } catch (err) {
    findings.push(`mcp_connection_events prune skipped: ${String(err)}`)
  }

  const ok = findings.every((f) => !f.includes('skipped:'))
  logger.info('DB consistency maintenance complete', { checked, fixed, findings: findings.length })
  return {
    kind: 'db-consistency',
    ok,
    checked,
    fixed,
    findings,
    detail: { stuckRunMinutes: STUCK_RUN_MINUTES, retentionDays: config.HERMES_EVENT_RETENTION_DAYS },
  }
}

type HygieneRule = {
  path: string
  label: string
  mustContain?: string[]
  mustNotContain?: string[]
  /** When mustContain fails, write this snippet if the file is missing a known helper. */
  autofixInsert?: { after: string; insert: string }
}

const HYGIENE: HygieneRule[] = [
  {
    path: 'server/src/cowork/task.ts',
    label: 'cowork path jail (resolveAllowedSourcePath)',
    mustContain: ['resolveAllowedSourcePath'],
  },
  {
    path: 'app/src/components/chat/ToolCallCard.tsx',
    label: 'ToolCallCard must not use dangerouslySetInnerHTML',
    mustNotContain: ['dangerouslySetInnerHTML'],
  },
]

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
}

/**
 * Bug-bounty / Bugbot hygiene: check then auto-fix what is safe.
 * Code regressions that need human review are reported; stale bindings + stuck
 * runs are repaired (same as consistency overlap for defense in depth).
 */
export async function runBugBountyMaintenance(): Promise<MaintenanceResult> {
  const findings: string[] = []
  let checked = 0
  let fixed = 0

  for (const rule of HYGIENE) {
    checked += 1
    const abs = join(REPO_ROOT, rule.path)
    if (!existsSync(abs)) {
      findings.push(`FAIL ${rule.label}: missing ${rule.path}`)
      continue
    }
    let src = readFileSync(abs, 'utf8')
    let changed = false

    if (rule.mustContain) {
      for (const needle of rule.mustContain) {
        if (!src.includes(needle)) {
          findings.push(`FAIL ${rule.label}: missing "${needle}" in ${rule.path}`)
        }
      }
    }

    if (rule.mustNotContain) {
      for (const needle of rule.mustNotContain) {
        if (stripComments(src).includes(needle)) {
          // Safe auto-fix: comment out live usages (preserves history for review).
          const next = src.replace(
            new RegExp(`^([ \\t]*)(.*${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}.*)$`, 'gm'),
            (_m, indent: string, line: string) => {
              if (line.trimStart().startsWith('//')) return `${indent}${line}`
              changed = true
              return `${indent}// [bug-bounty auto-fix] ${line.trimStart()}`
            },
          )
          if (changed) {
            src = next
            findings.push(`FIXED ${rule.label}: commented out live "${needle}" in ${rule.path}`)
            fixed += 1
          } else {
            findings.push(`FAIL ${rule.label}: found "${needle}" in ${rule.path}`)
          }
        }
      }
    }

    if (changed) {
      await Bun.write(abs, src)
    }
  }

  // Defense in depth: also clear stale cron bindings (security surface).
  const bindings = await cleanupStaleCronBindings()
  checked += Math.max(1, bindings.checked)
  fixed += bindings.fixed
  findings.push(...bindings.findings)

  const sql = getSql()
  const stuckBefore = await countUnsafe(
    sql,
    `SELECT count(*)::int AS c FROM cron_runs
WHERE status = 'running' AND started_at < NOW() - INTERVAL '${STUCK_RUN_MINUTES} minutes'`,
  )
  checked += 1
  if (stuckBefore > 0) {
    await execUnsafe(
      sql,
      `UPDATE cron_runs
SET status = 'failed',
    error = COALESCE(error, 'Marked failed by bug-bounty maintenance (stuck running)'),
    finished_at = NOW()
WHERE status = 'running' AND started_at < NOW() - INTERVAL '${STUCK_RUN_MINUTES} minutes'`,
    )
    fixed += stuckBefore
    findings.push(`stuck cron_runs: marked ${stuckBefore} failed`)
  }

  const hardFails = findings.filter((f) => f.startsWith('FAIL ')).length
  const ok = hardFails === 0
  logger.info('Bug-bounty maintenance complete', { checked, fixed, hardFails, findings: findings.length })
  return {
    kind: 'bug-bounty',
    ok,
    checked,
    fixed,
    findings,
    detail: { hardFails, repoRoot: REPO_ROOT },
  }
}

export async function runSystemMaintenance(kind: CronSystemKind): Promise<MaintenanceResult> {
  if (kind === 'db-consistency') return runDbConsistencyMaintenance()
  return runBugBountyMaintenance()
}
