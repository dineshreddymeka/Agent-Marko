import { Cron } from 'croner'
import { randomUUID } from 'node:crypto'
<<<<<<< HEAD
=======
import { EventType, type BaseEvent } from '@ag-ui/core'
import { HermesCustomEvents } from '@hermes/shared'
>>>>>>> origin/main
import { cronRepo } from '../db/repositories/cron'
import { sessionsRepo } from '../db/repositories/sessions'
import { runEventsRepo } from '../db/repositories/run_events'
import { nativeProvider } from '../agent/providers/native'
import { runWithCronBindings } from './run-bindings'
import { logger } from '../log'

const scheduled = new Map<string, Cron>()

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function runCronJob(jobId: string, opts?: { force?: boolean }): Promise<void> {
  const job = await cronRepo.getJob(jobId)
  if (!job) return
  if (!opts?.force && !job.enabled) return

  logger.info('Cron job fired', { jobId, name: job.name })
  const workflow = job.workflow
  const bindings = {
    jobId: job.id,
    jobName: job.name,
    mcpServerIds: job.mcpServerIds,
    skillIds: job.skillIds,
    headlessAutoApprove: workflow.headlessAutoApprove ?? false,
  }
  const detail: Record<string, unknown> = {
    mcpAllowed: job.mcpServerIds,
    skillsForced: job.skillIds,
    headlessAutoApprove: bindings.headlessAutoApprove,
  }
  let runId: string | null = null

  try {
    const session = await sessionsRepo.create({
      title: `Cron: ${job.name}`,
      profileId: job.profileId,
      groupName: 'cron',
    })
    const run = await cronRepo.createRun(jobId, session.id, detail)
    runId = run?.id ?? null
    const agentRunId = randomUUID()

    // Persist run events so the cron result session replays them on open.
    let seq = 0
    const emit = (event: BaseEvent) => {
      const currentSeq = ++seq
      void runEventsRepo
        .append({
          runId: agentRunId,
          sessionId: session.id,
          seq: currentSeq,
          eventType: event.type,
          payload: event,
        })
        .catch(() => undefined)
    }

    emit({
      type: EventType.CUSTOM,
      name: HermesCustomEvents.CRON_FIRED,
      value: { jobId: job.id, jobName: job.name },
    } as BaseEvent)

    const maxAttempts = Math.max(1, workflow.retry?.maxAttempts ?? 1)
    const backoffSec = Math.max(0, workflow.retry?.backoffSec ?? 0)
    let attempts = 0
    let lastError: unknown = null

    while (attempts < maxAttempts) {
      attempts += 1
      try {
        await runWithCronBindings(bindings, () =>
          nativeProvider.run(
            {
              threadId: session.id,
              runId: attempts === 1 ? agentRunId : randomUUID(),
              messages: [{ id: randomUUID(), role: 'user', content: job.prompt }],
              tools: [],
              state: {},
              context: [],
            },
            emit,
            new AbortController().signal,
          ),
        )
        lastError = null
        break
      } catch (err) {
        lastError = err
        logger.warn('Cron job attempt failed', { jobId, attempt: attempts, error: String(err) })
        if (attempts < maxAttempts && backoffSec > 0) await sleep(backoffSec * 1000)
      }
    }

    detail.attempts = attempts
    await cronRepo.updateJob(jobId, { lastRun: new Date() })
    if (lastError) throw lastError
    if (runId) await cronRepo.finishRun(runId, 'completed', null, detail)
  } catch (err) {
    if (runId) await cronRepo.finishRun(runId, 'failed', String(err), detail)
    logger.error('Cron job failed', { jobId, error: String(err) })
  }
}

export async function startCronScheduler(): Promise<void> {
  const jobs = await cronRepo.listJobs()
  for (const job of jobs) {
    if (!job.enabled) continue
    scheduleJob(job.id, job.schedule, job.timezone)
  }
  logger.info('Cron scheduler started', { jobs: scheduled.size })
}

export function scheduleJob(jobId: string, expression: string, timezone?: string): void {
  const existing = scheduled.get(jobId)
  if (existing) existing.stop()
  const cron = new Cron(expression, { timezone: timezone || undefined }, () => {
    void runCronJob(jobId)
  })
  scheduled.set(jobId, cron)
  const next = cron.nextRun()
  if (next) {
    void cronRepo.updateJob(jobId, { nextRun: next })
  }
}

export function describeCron(expression: string): { valid: boolean; preview: string; nextRun: string | null } {
  try {
    const cron = new Cron(expression, { paused: true })
    const next = cron.nextRun()
    return {
      valid: true,
      preview: next ? `Next run ${next.toISOString()}` : 'Valid schedule',
      nextRun: next?.toISOString() ?? null,
    }
  } catch (err) {
    return { valid: false, preview: String(err), nextRun: null }
  }
}

export function unscheduleJob(jobId: string): void {
  scheduled.get(jobId)?.stop()
  scheduled.delete(jobId)
}

export function activeCronCount(): number {
  return scheduled.size
}

/** Validate a cron expression and return next run ISO (or error). */
export function previewCron(expression: string): { ok: true; nextRun: string; preview: string } | { ok: false; error: string } {
  try {
    const cron = new Cron(expression, { paused: true })
    const next = cron.nextRun()
    cron.stop()
    if (!next) return { ok: false, error: 'No next run' }
    return {
      ok: true,
      nextRun: next.toISOString(),
      preview: `Next run ${next.toLocaleString()}`,
    }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}
