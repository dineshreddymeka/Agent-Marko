/**
 * Smart Cron repo — array-column filters + workflow round-trip (integration).
 * Requires HERMES_INTEGRATION_TEST=1 and the local Postgres 17 on :5433.
 * Author: Dinesh Reddy Meka
 */
import { afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { isIntegrationEnabled, prepareIntegrationDb, truncateAppTables } from './helpers/db'
import { cronRepo } from '../src/db/repositories/cron'
import { mcpServersRepo } from '../src/db/repositories/mcp_servers'
import { skillsRepo } from '../src/db/repositories/skills'
import type { CronWorkflow } from '@hermes/shared'

const enabled = await isIntegrationEnabled()

describe.skipIf(!enabled)('cron workflow repository (integration)', () => {
  beforeAll(async () => {
    await prepareIntegrationDb()
  })

  afterEach(async () => {
    await truncateAppTables()
  })

  async function seedBindings() {
    const server = await mcpServersRepo.create({
      name: `cron-test-mcp-${Date.now()}`,
      transport: 'http',
      url: 'http://localhost:9999/mcp',
      enabled: true,
    })
    const { skill } = await skillsRepo.upsert({
      name: `cron-test-skill-${Date.now()}`,
      bodyMd: '# test skill',
      source: 'learned',
    })
    return { server, skill }
  }

  function workflowFor(mcpId: string, skillId: string): CronWorkflow {
    return {
      version: 1,
      intent: 'integration test job',
      timezone: 'UTC',
      mcpServerIds: [mcpId],
      skillIds: [skillId],
      headlessAutoApprove: true,
      retry: { maxAttempts: 2, backoffSec: 5 },
      steps: [
        { id: 's1', label: 'Fetch', type: 'mcp', mcpServerId: mcpId, parallelGroup: 'g1' },
        { id: 's2', label: 'Summarize', type: 'prompt', prompt: 'go', dependsOn: ['s1'] },
      ],
    }
  }

  test('createJob persists workflow JSONB and denormalized arrays', async () => {
    const { server, skill } = await seedBindings()
    const job = await cronRepo.createJob({
      name: 'wf job',
      schedule: '0 9 * * *',
      prompt: 'do the thing',
      timezone: 'America/New_York',
      workflow: workflowFor(server.id, skill.id),
    })

    expect(job.timezone).toBe('America/New_York')
    expect(job.mcpServerIds).toEqual([server.id])
    expect(job.skillIds).toEqual([skill.id])
    expect(job.workflow.headlessAutoApprove).toBe(true)
    expect(job.workflow.retry).toEqual({ maxAttempts: 2, backoffSec: 5 })
    expect(job.workflow.steps).toHaveLength(2)
    expect(job.workflow.steps?.[0]?.parallelGroup).toBe('g1')
    expect(job.workflow.steps?.[1]?.dependsOn).toEqual(['s1'])

    const fetched = await cronRepo.getJob(job.id)
    expect(fetched?.workflow.mcpServerIds).toEqual([server.id])
  })

  test('listJobs filters by mcpServerId / skillId via array contains', async () => {
    const { server, skill } = await seedBindings()
    const bound = await cronRepo.createJob({
      name: 'bound job',
      schedule: '0 * * * *',
      prompt: 'bound',
      workflow: workflowFor(server.id, skill.id),
    })
    const unbound = await cronRepo.createJob({
      name: 'unbound job',
      schedule: '0 * * * *',
      prompt: 'unbound',
    })

    const byMcp = await cronRepo.listJobs({ mcpServerId: server.id })
    expect(byMcp.map((j) => j.id)).toEqual([bound.id])

    const bySkill = await cronRepo.listJobs({ skillId: skill.id })
    expect(bySkill.map((j) => j.id)).toEqual([bound.id])

    const all = await cronRepo.listJobs()
    expect(all.map((j) => j.id).sort()).toEqual([bound.id, unbound.id].sort())
  })

  test('updateJob with workflow resyncs array columns', async () => {
    const { server, skill } = await seedBindings()
    const job = await cronRepo.createJob({
      name: 'resync job',
      schedule: '0 * * * *',
      prompt: 'x',
      workflow: workflowFor(server.id, skill.id),
    })

    const cleared = await cronRepo.updateJob(job.id, {
      workflow: {
        version: 1,
        timezone: 'UTC',
        mcpServerIds: [],
        skillIds: [],
        headlessAutoApprove: false,
      },
    })
    expect(cleared?.mcpServerIds).toEqual([])
    expect(cleared?.skillIds).toEqual([])
    expect(cleared?.updatedAt).not.toBeNull()

    const byMcp = await cronRepo.listJobs({ mcpServerId: server.id })
    expect(byMcp).toHaveLength(0)
  })

  test('cron runs persist per-run detail snapshots', async () => {
    const job = await cronRepo.createJob({ name: 'run job', schedule: '0 * * * *', prompt: 'x' })
    const run = await cronRepo.createRun(job.id, null, { mcpAllowed: [], skillsForced: [] })
    expect(run).toBeDefined()
    await cronRepo.finishRun(run!.id, 'completed', null, {
      mcpAllowed: [],
      skillsForced: [],
      attempts: 1,
    })
    const runs = await cronRepo.listRuns(job.id)
    expect(runs).toHaveLength(1)
    expect(runs[0]!.status).toBe('completed')
    expect(runs[0]!.detail).toEqual({ mcpAllowed: [], skillsForced: [], attempts: 1 })
  })

  test('deleting MCP server strips id from cron arrays and workflow JSON', async () => {
    const a = await mcpServersRepo.create({
      name: `mcp-a-${Date.now()}`,
      transport: 'http',
      url: 'http://localhost:9999/a',
    })
    const b = await mcpServersRepo.create({
      name: `mcp-b-${Date.now()}`,
      transport: 'http',
      url: 'http://localhost:9999/b',
    })
    const { skill } = await skillsRepo.upsert({
      name: `skill-keep-${Date.now()}`,
      bodyMd: '# keep',
      source: 'learned',
    })

    const job = await cronRepo.createJob({
      name: 'mcp cleanup job',
      schedule: '0 * * * *',
      prompt: 'bound',
      workflow: {
        version: 1,
        timezone: 'UTC',
        mcpServerIds: [a.id, b.id],
        skillIds: [skill.id],
        headlessAutoApprove: true,
      },
      mcpServerIds: [a.id, b.id],
      skillIds: [skill.id],
    })
    const before = await cronRepo.getJob(job.id)
    expect(before?.updatedAt).not.toBeNull()

    const deleted = await mcpServersRepo.delete(a.id)
    expect(deleted).toBe(true)

    const after = await cronRepo.getJob(job.id)
    expect(after).not.toBeNull()
    expect(after!.mcpServerIds).toEqual([b.id])
    expect(after!.workflow.mcpServerIds).toEqual([b.id])
    expect(after!.skillIds).toEqual([skill.id])
    expect(after!.workflow.skillIds).toEqual([skill.id])
    expect(after!.updatedAt).not.toBeNull()
    expect(after!.updatedAt).not.toBe(before!.updatedAt)

    const stillBound = await cronRepo.listJobs({ mcpServerId: a.id })
    expect(stillBound).toHaveLength(0)
    const byB = await cronRepo.listJobs({ mcpServerId: b.id })
    expect(byB.map((j) => j.id)).toEqual([job.id])
  })

  test('deleting skill strips id from cron arrays and workflow JSON', async () => {
    const server = await mcpServersRepo.create({
      name: `mcp-keep-${Date.now()}`,
      transport: 'http',
      url: 'http://localhost:9999/keep',
    })
    const { skill: keep } = await skillsRepo.upsert({
      name: `skill-a-${Date.now()}`,
      bodyMd: '# a',
      source: 'learned',
    })
    const { skill: drop } = await skillsRepo.upsert({
      name: `skill-b-${Date.now()}`,
      bodyMd: '# b',
      source: 'learned',
    })

    const job = await cronRepo.createJob({
      name: 'skill cleanup job',
      schedule: '0 * * * *',
      prompt: 'bound',
      workflow: {
        version: 1,
        timezone: 'UTC',
        mcpServerIds: [server.id],
        skillIds: [keep.id, drop.id],
      },
      mcpServerIds: [server.id],
      skillIds: [keep.id, drop.id],
    })
    const before = await cronRepo.getJob(job.id)

    const deleted = await skillsRepo.delete(drop.id)
    expect(deleted).toBe(true)

    const after = await cronRepo.getJob(job.id)
    expect(after).not.toBeNull()
    expect(after!.skillIds).toEqual([keep.id])
    expect(after!.workflow.skillIds).toEqual([keep.id])
    expect(after!.mcpServerIds).toEqual([server.id])
    expect(after!.workflow.mcpServerIds).toEqual([server.id])
    expect(after!.updatedAt).not.toBeNull()
    expect(after!.updatedAt).not.toBe(before!.updatedAt)

    const stillBound = await cronRepo.listJobs({ skillId: drop.id })
    expect(stillBound).toHaveLength(0)
    const byKeep = await cronRepo.listJobs({ skillId: keep.id })
    expect(byKeep.map((j) => j.id)).toEqual([job.id])
  })

  test('removeDeletedMcpServerBinding / removeDeletedSkillBinding are idempotent', async () => {
    const server = await mcpServersRepo.create({
      name: `mcp-idemp-${Date.now()}`,
      transport: 'http',
      url: 'http://localhost:9999/idemp',
    })
    const { skill } = await skillsRepo.upsert({
      name: `skill-idemp-${Date.now()}`,
      bodyMd: '# idemp',
      source: 'learned',
    })
    const job = await cronRepo.createJob({
      name: 'idemp job',
      schedule: '0 * * * *',
      prompt: 'x',
      workflow: workflowFor(server.id, skill.id),
    })

    await cronRepo.removeDeletedMcpServerBinding(server.id)
    await cronRepo.removeDeletedMcpServerBinding(server.id)
    await cronRepo.removeDeletedSkillBinding(skill.id)
    await cronRepo.removeDeletedSkillBinding(skill.id)

    const after = await cronRepo.getJob(job.id)
    expect(after!.mcpServerIds).toEqual([])
    expect(after!.skillIds).toEqual([])
    expect(after!.workflow.mcpServerIds).toEqual([])
    expect(after!.workflow.skillIds).toEqual([])
  })
})
