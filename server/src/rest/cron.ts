import { jsonResponse, parseJson } from './helpers'
import { requireDatabaseOrResponse, withDatabase } from './db-guard'

export async function handleCron(req: Request, path: string): Promise<Response | null> {
  const { cronRepo } = await import('../db/repositories/cron')
  const { scheduleJob, unscheduleJob } = await import('../cron/scheduler')
  const parts = path.split('/').filter(Boolean)

  if (req.method === 'GET' && parts.length === 2) {
    return jsonResponse(await withDatabase(() => cronRepo.listJobs(), []))
  }

  if (req.method === 'POST' && parts.length === 2) {
    const unavailable = await requireDatabaseOrResponse()
    if (unavailable) return unavailable
    const body = await parseJson(req)
    if (!body?.name || !body?.schedule || !body?.prompt) {
      return jsonResponse({ error: 'name, schedule, prompt required' }, 400)
    }
    const job = await cronRepo.createJob({
      name: String(body.name),
      schedule: String(body.schedule),
      prompt: String(body.prompt),
      profileId: body.profileId ? String(body.profileId) : null,
      enabled: body.enabled !== false,
    })
    scheduleJob(job.id, job.schedule)
    return jsonResponse(job, 201)
  }

  if (parts.length === 3) {
    const id = parts[2]!
    if (req.method === 'GET' && parts.length === 4 && parts[3] === 'runs') {
      return jsonResponse(await cronRepo.listRuns(id))
    }
    if (req.method === 'PATCH') {
      const body = await parseJson(req)
      const job = await cronRepo.updateJob(id, body ?? {})
      if (!job) return jsonResponse({ error: 'Not found' }, 404)
      if (body?.schedule) scheduleJob(id, String(body.schedule))
      if (body?.enabled === false) unscheduleJob(id)
      return jsonResponse(job)
    }
    if (req.method === 'DELETE') {
      unscheduleJob(id)
      return jsonResponse({ deleted: await cronRepo.deleteJob(id) })
    }
  }

  if (parts.length === 4 && parts[3] === 'runs' && req.method === 'GET') {
    return jsonResponse(await cronRepo.listRuns(parts[2]!))
  }

  return null
}
