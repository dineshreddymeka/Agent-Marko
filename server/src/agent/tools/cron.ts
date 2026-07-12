import { cronRepo } from '../../db/repositories/cron'
import { describeCron, scheduleJob } from '../../cron/scheduler'
import { ToolError } from '../../errors'
import { registerTool } from './registry'

registerTool({
  name: 'cron_create',
  description:
    'Create a scheduled cron job when name, schedule (cron expression), and prompt are fully specified. If any detail is missing or ambiguous, call cron_form_show instead of asking questions in text.',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      schedule: { type: 'string', description: 'Cron expression' },
      prompt: { type: 'string' },
      timezone: { type: 'string', description: 'IANA timezone (default UTC)' },
    },
    required: ['name', 'schedule', 'prompt'],
  },
  async execute(args) {
    const schedule = String(args.schedule)
    const check = describeCron(schedule)
    if (!check.valid) {
      throw new ToolError(`Invalid cron schedule: ${check.preview}`)
    }
    const timezone = args.timezone ? String(args.timezone) : 'UTC'
    const job = await cronRepo.createJob({
      name: String(args.name),
      schedule,
      prompt: String(args.prompt),
      timezone,
      nextRun: check.nextRun ? new Date(check.nextRun) : null,
    })
    // Known bug fix: newly created jobs must be registered with the live scheduler.
    if (job.enabled) scheduleJob(job.id, job.schedule, job.timezone)
    return job
  },
})

registerTool({
  name: 'cron_list',
  description: 'List cron jobs',
  parameters: { type: 'object', properties: {} },
  async execute() {
    return cronRepo.listJobs()
  },
})

registerTool({
  name: 'cron_delete',
  description: 'Delete a cron job by id',
  dangerous: true,
  parameters: {
    type: 'object',
    properties: { id: { type: 'string' } },
    required: ['id'],
  },
  async execute(args) {
    const ok = await cronRepo.deleteJob(String(args.id))
    return { deleted: ok }
  },
})
