import { Cron } from 'croner'
import { randomUUID } from 'node:crypto'
import { EventType } from '@ag-ui/core'
import { cronRepo } from '../db/repositories/cron'
import { sessionsRepo } from '../db/repositories/sessions'
import { nativeProvider } from '../agent/providers/native'
import { logger } from '../log'

const scheduled = new Map<string, Cron>()

async function runCronJob(jobId: string): Promise<void> {
  const job = await cronRepo.getJob(jobId)
  if (!job || !job.enabled) return

  const run = await cronRepo.createRun(jobId)
  logger.info('Cron job fired', { jobId, name: job.name })

  try {
    const session = await sessionsRepo.create({
      title: `Cron: ${job.name}`,
      profileId: job.profileId,
      groupName: 'cron',
    })
    await cronRepo.finishRun(run!.id, 'running')
    const runId = randomUUID()
    const events: unknown[] = []
    await nativeProvider.run(
      {
        threadId: session.id,
        runId,
        messages: [{ id: randomUUID(), role: 'user', content: job.prompt }],
        tools: [],
        state: {},
        context: [],
      },
      (event) => {
        events.push(event)
      },
      new AbortController().signal,
    )
    await cronRepo.updateJob(jobId, { lastRun: new Date() })
    await cronRepo.finishRun(run!.id, 'completed')
  } catch (err) {
    await cronRepo.finishRun(run!.id, 'failed', String(err))
    logger.error('Cron job failed', { jobId, error: String(err) })
  }
}

export async function startCronScheduler(): Promise<void> {
  const jobs = await cronRepo.listJobs()
  for (const job of jobs) {
    if (!job.enabled) continue
    scheduleJob(job.id, job.schedule)
  }
  logger.info('Cron scheduler started', { jobs: scheduled.size })
}

export function scheduleJob(jobId: string, expression: string): void {
  const existing = scheduled.get(jobId)
  if (existing) existing.stop()
  const cron = new Cron(expression, () => {
    void runCronJob(jobId)
  })
  scheduled.set(jobId, cron)
}

export function unscheduleJob(jobId: string): void {
  scheduled.get(jobId)?.stop()
  scheduled.delete(jobId)
}

export function activeCronCount(): number {
  return scheduled.size
}
