import { parseCronWorkflow, type CronWorkflow } from '@hermes/shared'
import { jsonResponse, parseJson } from './helpers'
import { requireDatabaseOrResponse, withDatabase } from './db-guard'

type BindingCheck = {
  mcpServers: Array<{
    id: string
    name: string
    enabled: boolean
    lastStatus: string | null
    lastError: string | null
    healthy: boolean
  }>
  unknownMcpIds: string[]
  skills: Array<{ id: string; name: string }>
  unknownSkillIds: string[]
}

/** Resolve MCP/skill uuid bindings to live rows + health status (for validation and Review). */
async function checkBindings(mcpServerIds: string[], skillIds: string[]): Promise<BindingCheck> {
  const { mcpServersRepo } = await import('../db/repositories/mcp_servers')
  const { skillsRepo } = await import('../db/repositories/skills')

  const mcpServers: BindingCheck['mcpServers'] = []
  const unknownMcpIds: string[] = []
  for (const id of mcpServerIds) {
    const server = await mcpServersRepo.getById(id).catch(() => null)
    if (!server) {
      unknownMcpIds.push(id)
      continue
    }
    mcpServers.push({
      id: server.id,
      name: server.name,
      enabled: server.enabled,
      lastStatus: server.lastStatus,
      lastError: server.lastError,
      healthy: server.enabled && server.lastStatus === 'connected',
    })
  }

  const skills: BindingCheck['skills'] = []
  const unknownSkillIds: string[] = []
  for (const id of skillIds) {
    const skill = await skillsRepo.getById(id).catch(() => null)
    if (!skill) {
      unknownSkillIds.push(id)
      continue
    }
    skills.push({ id: skill.id, name: skill.name })
  }

  return { mcpServers, unknownMcpIds, skills, unknownSkillIds }
}

function parseWorkflowFromBody(body: Record<string, unknown>):
  | { ok: true; workflow: CronWorkflow | undefined }
  | { ok: false; response: Response } {
  if (body.workflow === undefined) return { ok: true, workflow: undefined }
  const parsed = parseCronWorkflow(body.workflow)
  if (!parsed.ok) {
    return {
      ok: false,
      response: jsonResponse({ error: 'Invalid workflow', detail: parsed.error }, 400),
    }
  }
  return { ok: true, workflow: parsed.workflow }
}

export async function handleCron(req: Request, path: string): Promise<Response | null> {
  const { cronRepo } = await import('../db/repositories/cron')
  const { scheduleJob, unscheduleJob, runCronJob, describeCron } = await import('../cron/scheduler')
  const parts = path.split('/').filter(Boolean)

  if (req.method === 'GET' && parts.length === 2) {
    const url = new URL(req.url)
    const mcpServerId = url.searchParams.get('mcpServerId') ?? undefined
    const skillId = url.searchParams.get('skillId') ?? undefined
    return jsonResponse(
      await withDatabase(() => cronRepo.listJobs({ mcpServerId, skillId }), []),
    )
  }

  if (req.method === 'POST' && parts.length === 3 && parts[2] === 'validate') {
    const body = await parseJson(req)
    const schedule = String(body?.schedule ?? '')
    return jsonResponse(describeCron(schedule))
  }

  // Built-in maintenance jobs (DB Consistency + Bug Bounty), seeded on scheduler start.
  if (req.method === 'GET' && parts.length === 3 && parts[2] === 'system') {
    const { SYSTEM_CRON_JOBS, SYSTEM_CRON_SCHEDULE, isSystemCronJob } = await import('../cron/system-jobs')
    const jobs = await withDatabase(() => cronRepo.listJobs(), [])
    const systemJobs = jobs.filter((j) => isSystemCronJob(j) != null)
    return jsonResponse({
      schedule: SYSTEM_CRON_SCHEDULE,
      catalog: SYSTEM_CRON_JOBS.map((j) => ({
        name: j.name,
        kind: j.kind,
        schedule: SYSTEM_CRON_SCHEDULE,
        prompt: j.prompt,
      })),
      jobs: systemJobs,
    })
  }

  // Wizard Review helper: validates schedule + resolves MCP/skill bindings with live health.
  if (req.method === 'POST' && parts.length === 4 && parts[2] === 'wizard' && parts[3] === 'preview') {
    const unavailable = await requireDatabaseOrResponse()
    if (unavailable) return unavailable
    const body = (await parseJson(req)) ?? {}
    const schedule = body.schedule != null ? describeCron(String(body.schedule)) : null
    const mcpServerIds = Array.isArray(body.mcpServerIds) ? body.mcpServerIds.map(String) : []
    const skillIds = Array.isArray(body.skillIds) ? body.skillIds.map(String) : []
    const bindings = await checkBindings(mcpServerIds, skillIds)
    return jsonResponse({ schedule, ...bindings })
  }

  if (req.method === 'POST' && parts.length === 2) {
    const unavailable = await requireDatabaseOrResponse()
    if (unavailable) return unavailable
    const body = await parseJson(req)
    if (!body?.name || !body?.schedule || !body?.prompt) {
      return jsonResponse({ error: 'name, schedule, prompt required' }, 400)
    }
    const check = describeCron(String(body.schedule))
    if (!check.valid) {
      return jsonResponse({ error: 'Invalid cron schedule', detail: check.preview }, 400)
    }

    const parsedWorkflow = parseWorkflowFromBody(body)
    if (!parsedWorkflow.ok) return parsedWorkflow.response
    const workflow = parsedWorkflow.workflow

    if (workflow) {
      const bindings = await checkBindings(workflow.mcpServerIds, workflow.skillIds)
      if (bindings.unknownMcpIds.length || bindings.unknownSkillIds.length) {
        return jsonResponse(
          {
            error: 'Unknown workflow bindings',
            unknownMcpIds: bindings.unknownMcpIds,
            unknownSkillIds: bindings.unknownSkillIds,
          },
          400,
        )
      }
    }

    const timezone = body.timezone
      ? String(body.timezone)
      : workflow?.timezone ?? 'UTC'
    const job = await cronRepo.createJob({
      name: String(body.name),
      schedule: String(body.schedule),
      prompt: String(body.prompt),
      profileId: body.profileId
        ? String(body.profileId)
        : workflow?.profileId ?? null,
      enabled: body.enabled !== false,
      nextRun: check.nextRun ? new Date(check.nextRun) : null,
      timezone,
      workflow,
    })
    if (job.enabled) scheduleJob(job.id, job.schedule, job.timezone)
    void import('../indexer/service')
      .then(({ queueRuntimeRecord }) => queueRuntimeRecord('cron_job', job.id))
      .catch((err) => {
        void import('../log').then(({ logger }) =>
          logger.warn('Failed to queue cron index upsert', { id: job.id, error: String(err) }),
        )
      })
    return jsonResponse(job, 201)
  }

  if (parts.length === 4 && parts[3] === 'runs' && req.method === 'GET') {
    return jsonResponse(await cronRepo.listRuns(parts[2]!))
  }

  if (parts.length === 4 && parts[3] === 'run' && req.method === 'POST') {
    const unavailable = await requireDatabaseOrResponse()
    if (unavailable) return unavailable
    const job = await cronRepo.getJob(parts[2]!)
    if (!job) return jsonResponse({ error: 'Not found' }, 404)
    void runCronJob(job.id, { force: true })
    return jsonResponse({ ok: true, jobId: job.id })
  }

  if (parts.length === 3) {
    const id = parts[2]!
    if (req.method === 'PATCH') {
      const body = (await parseJson(req)) ?? {}
      if (body.schedule) {
        const check = describeCron(String(body.schedule))
        if (!check.valid) {
          return jsonResponse({ error: 'Invalid cron schedule', detail: check.preview }, 400)
        }
      }

      const parsedWorkflow = parseWorkflowFromBody(body)
      if (!parsedWorkflow.ok) return parsedWorkflow.response
      const workflow = parsedWorkflow.workflow

      if (workflow) {
        const bindings = await checkBindings(workflow.mcpServerIds, workflow.skillIds)
        if (bindings.unknownMcpIds.length || bindings.unknownSkillIds.length) {
          return jsonResponse(
            {
              error: 'Unknown workflow bindings',
              unknownMcpIds: bindings.unknownMcpIds,
              unknownSkillIds: bindings.unknownSkillIds,
            },
            400,
          )
        }
      }

      const patch: Record<string, unknown> = {}
      for (const key of ['name', 'schedule', 'prompt', 'profileId', 'enabled', 'timezone'] as const) {
        if (key in body) patch[key] = body[key]
      }
      if (workflow) patch.workflow = workflow

      const job = await cronRepo.updateJob(id, patch as Parameters<typeof cronRepo.updateJob>[1])
      if (!job) return jsonResponse({ error: 'Not found' }, 404)
      if ((body.schedule || body.timezone) && job.enabled) {
        scheduleJob(id, job.schedule, job.timezone)
      }
      if (body.enabled === false) unscheduleJob(id)
      if (body.enabled === true) scheduleJob(id, job.schedule, job.timezone)
      void import('../indexer/service')
        .then(({ queueRuntimeRecord }) => queueRuntimeRecord('cron_job', job.id))
        .catch((err) => {
          void import('../log').then(({ logger }) =>
            logger.warn('Failed to queue cron index upsert', { id: job.id, error: String(err) }),
          )
        })
      return jsonResponse(job)
    }
    if (req.method === 'DELETE') {
      unscheduleJob(id)
      const deleted = await cronRepo.deleteJob(id)
      if (deleted) {
        void import('../indexer/service')
          .then(({ queueRuntimeDelete }) => queueRuntimeDelete('cron_job', id))
          .catch((err) => {
            void import('../log').then(({ logger }) =>
              logger.warn('Failed to queue cron index delete', { id, error: String(err) }),
            )
          })
      }
      return jsonResponse({ deleted })
    }
  }

  return null
}
