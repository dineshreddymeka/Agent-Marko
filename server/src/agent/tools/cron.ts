import { cronRepo } from '../../db/repositories/cron'
import { registerTool } from './registry'

registerTool({
  name: 'cron_create',
  description: 'Create a scheduled cron job',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      schedule: { type: 'string', description: 'Cron expression' },
      prompt: { type: 'string' },
    },
    required: ['name', 'schedule', 'prompt'],
  },
  async execute(args) {
    return cronRepo.createJob({
      name: String(args.name),
      schedule: String(args.schedule),
      prompt: String(args.prompt),
    })
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
