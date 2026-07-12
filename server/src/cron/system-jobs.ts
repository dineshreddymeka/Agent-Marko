/**
 * Seed + identify built-in maintenance cron jobs (every 2 minutes by default).
 * These run deterministic check-and-fix / auto-approve handlers — not LLM prompts.
 */
import type { CronSystemKind, CronWorkflow } from '@hermes/shared'
import { cronRepo } from '../db/repositories/cron'
import { logger } from '../log'

/** Default cadence for all system maintenance jobs. */
export const SYSTEM_CRON_SCHEDULE = '*/2 * * * *'

export const SYSTEM_CRON_JOBS: Array<{
  name: string
  kind: CronSystemKind
  prompt: string
}> = [
  {
    name: 'DB Consistency',
    kind: 'db-consistency',
    prompt:
      'System maintenance: check Postgres referential integrity, clear stale cron bindings, fail stuck runs, prune old events, and auto-fix safe issues.',
  },
  {
    name: 'Bug Bounty',
    kind: 'bug-bounty',
    prompt:
      'System maintenance: run security hygiene (path jail, XSS HTML), clear stale bindings, fail stuck runs, and auto-fix safe issues.',
  },
  {
    name: 'Status Auto-Approve',
    kind: 'status-auto-approve',
    prompt:
      'System maintenance: ensure global auto-approve is on, check pending HITL approvals / health status, and auto-approve anything waiting.',
  },
]

function systemWorkflow(kind: CronSystemKind): CronWorkflow {
  return {
    version: 1,
    systemKind: kind,
    timezone: 'UTC',
    mcpServerIds: [],
    skillIds: [],
    headlessAutoApprove: true,
    intent: `system:${kind}`,
  }
}

export function isSystemCronJob(job: {
  name: string
  workflow?: { systemKind?: CronSystemKind | null }
}): CronSystemKind | null {
  const kind = job.workflow?.systemKind
  if (kind === 'db-consistency' || kind === 'bug-bounty' || kind === 'status-auto-approve') {
    return kind
  }
  const byName = SYSTEM_CRON_JOBS.find((j) => j.name === job.name)
  return byName?.kind ?? null
}

/**
 * Ensure system maintenance jobs exist on the default 2-minute schedule.
 * Idempotent: updates schedule/workflow if a same-named row already exists.
 */
export async function ensureSystemCronJobs(): Promise<string[]> {
  const ids: string[] = []
  const existing = await cronRepo.listJobs()

  for (const def of SYSTEM_CRON_JOBS) {
    const workflow = systemWorkflow(def.kind)
    const found = existing.find(
      (j) => j.name === def.name || j.workflow.systemKind === def.kind,
    )

    if (found) {
      const needsUpdate =
        found.schedule !== SYSTEM_CRON_SCHEDULE ||
        found.workflow.systemKind !== def.kind ||
        found.enabled !== true ||
        found.timezone !== 'UTC'

      if (needsUpdate) {
        const updated = await cronRepo.updateJob(found.id, {
          name: def.name,
          schedule: SYSTEM_CRON_SCHEDULE,
          prompt: def.prompt,
          enabled: true,
          timezone: 'UTC',
          workflow,
          mcpServerIds: [],
          skillIds: [],
        })
        if (updated) ids.push(updated.id)
        else ids.push(found.id)
        logger.info('Updated system cron job', { name: def.name, kind: def.kind })
      } else {
        ids.push(found.id)
      }
      continue
    }

    const created = await cronRepo.createJob({
      name: def.name,
      schedule: SYSTEM_CRON_SCHEDULE,
      prompt: def.prompt,
      enabled: true,
      timezone: 'UTC',
      workflow,
      mcpServerIds: [],
      skillIds: [],
    })
    ids.push(created.id)
    logger.info('Seeded system cron job', { name: def.name, kind: def.kind, id: created.id })
  }

  return ids
}
