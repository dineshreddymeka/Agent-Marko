/**
 * Smart Cron workflow — zod schema + runtime binding filter units.
 * Author: Dinesh Reddy Meka
 */
import { describe, expect, test } from 'bun:test'
import {
  coerceCronWorkflow,
  cronWorkflowSchema,
  cronWorkflowStepSchema,
  DEFAULT_CRON_WORKFLOW,
  parseCronWorkflow,
} from '@hermes/shared'
import { registerTool, unregisterTool, toLlmTools, getTool, type ToolDefinition } from '../src/agent/tools/registry'
import { runWithCronBindings, getCronBindings } from '../src/cron/run-bindings'

const UUID_A = '11111111-1111-4111-8111-111111111111'
const UUID_B = '22222222-2222-4222-8222-222222222222'

describe('cron workflow zod schema', () => {
  test('accepts a full wizard payload and applies defaults', () => {
    const parsed = cronWorkflowSchema.parse({
      version: 1,
      intent: 'Summarize inbox every morning',
      timezone: 'America/New_York',
      mcpServerIds: [UUID_A],
      skillIds: [UUID_B],
      profileId: null,
      headlessAutoApprove: true,
      retry: { maxAttempts: 3, backoffSec: 60 },
      ui: { wizardCompletedAt: new Date().toISOString() },
    })
    expect(parsed.mcpServerIds).toEqual([UUID_A])
    expect(parsed.skillIds).toEqual([UUID_B])
    expect(parsed.headlessAutoApprove).toBe(true)
  })

  test('defaults arrays / timezone / approval when omitted', () => {
    const parsed = cronWorkflowSchema.parse({ version: 1 })
    expect(parsed.timezone).toBe('UTC')
    expect(parsed.mcpServerIds).toEqual([])
    expect(parsed.skillIds).toEqual([])
    expect(parsed.headlessAutoApprove).toBe(false)
  })

  test('rejects non-uuid MCP/skill ids', () => {
    expect(cronWorkflowSchema.safeParse({ version: 1, mcpServerIds: ['nope'] }).success).toBe(false)
    expect(cronWorkflowSchema.safeParse({ version: 1, skillIds: ['123'] }).success).toBe(false)
  })

  test('rejects unknown version and out-of-range retry', () => {
    expect(cronWorkflowSchema.safeParse({ version: 2 }).success).toBe(false)
    expect(
      cronWorkflowSchema.safeParse({ version: 1, retry: { maxAttempts: 0, backoffSec: 5 } }).success,
    ).toBe(false)
    expect(
      cronWorkflowSchema.safeParse({ version: 1, retry: { maxAttempts: 99, backoffSec: 5 } }).success,
    ).toBe(false)
  })

  test('steps support skill/mcp/prompt types with parallelGroup and dependsOn', () => {
    const steps = [
      { id: 'a', label: 'Pull data', type: 'mcp', mcpServerId: UUID_A, toolName: 'query' },
      { id: 'b', label: 'Apply skill', type: 'skill', skillId: UUID_B, parallelGroup: 'g1' },
      { id: 'c', label: 'Summarize', type: 'prompt', prompt: 'Summarize', dependsOn: ['a', 'b'] },
    ]
    const parsed = cronWorkflowSchema.parse({ version: 1, steps })
    expect(parsed.steps).toHaveLength(3)
    expect(parsed.steps?.[1]?.parallelGroup).toBe('g1')
    expect(parsed.steps?.[2]?.dependsOn).toEqual(['a', 'b'])
  })

  test('step schema rejects bad type and missing label', () => {
    expect(
      cronWorkflowStepSchema.safeParse({ id: 'x', label: 'X', type: 'webhook' }).success,
    ).toBe(false)
    expect(cronWorkflowStepSchema.safeParse({ id: 'x', type: 'prompt' }).success).toBe(false)
  })

  test('parseCronWorkflow tolerates empty JSONB and reports first issue', () => {
    expect(parseCronWorkflow({})).toEqual({ ok: true, workflow: { ...DEFAULT_CRON_WORKFLOW } })
    expect(parseCronWorkflow(null).ok).toBe(true)
    const bad = parseCronWorkflow({ version: 1, mcpServerIds: ['bad-id'] })
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.error).toContain('mcpServerIds')
  })

  test('coerceCronWorkflow never throws on garbage rows', () => {
    expect(coerceCronWorkflow('garbage')).toEqual({ ...DEFAULT_CRON_WORKFLOW })
    expect(coerceCronWorkflow(42)).toEqual({ ...DEFAULT_CRON_WORKFLOW })
  })
})

describe('cron run bindings — MCP allowlist tool filtering', () => {
  const mkTool = (name: string, mcpServerId?: string): ToolDefinition => ({
    name,
    description: 'test',
    parameters: { type: 'object', properties: {} },
    mcpServerId,
    async execute() {
      return { ok: true }
    },
  })

  const testTools = [
    mkTool('cron_test_plain'),
    mkTool('mcp:serverA/tool1', UUID_A),
    mkTool('mcp:serverB/tool2', UUID_B),
  ]

  const withTestTools = async (fn: () => Promise<void> | void) => {
    for (const t of testTools) registerTool(t)
    try {
      await fn()
    } finally {
      for (const t of testTools) unregisterTool(t.name)
    }
  }

  const bindings = (mcpServerIds: string[]) => ({
    jobId: 'job',
    jobName: 'Job',
    mcpServerIds,
    skillIds: [],
    headlessAutoApprove: false,
  })

  test('no bindings (interactive run) exposes all tools', async () => {
    await withTestTools(() => {
      expect(getCronBindings()).toBeUndefined()
      const names = toLlmTools().map((t) => t.function.name)
      expect(names).toContain('cron_test_plain')
      expect(names).toContain('mcp:serverA/tool1')
      expect(names).toContain('mcp:serverB/tool2')
    })
  })

  test('allowlist keeps only tools from allowed servers', async () => {
    await withTestTools(async () => {
      await runWithCronBindings(bindings([UUID_A]), async () => {
        const names = toLlmTools().map((t) => t.function.name)
        expect(names).toContain('cron_test_plain')
        expect(names).toContain('mcp:serverA/tool1')
        expect(names).not.toContain('mcp:serverB/tool2')
        expect(getTool('mcp:serverB/tool2')).toBeUndefined()
        expect(getTool('mcp:serverA/tool1')).toBeDefined()
      })
    })
  })

  test('EMPTY allowlist means no MCP tools at all (not "all")', async () => {
    await withTestTools(async () => {
      await runWithCronBindings(bindings([]), async () => {
        const names = toLlmTools().map((t) => t.function.name)
        expect(names).toContain('cron_test_plain')
        expect(names.some((n) => n.startsWith('mcp:'))).toBe(false)
        expect(getTool('mcp:serverA/tool1')).toBeUndefined()
      })
    })
  })

  test('bindings do not leak outside the scoped run', async () => {
    await runWithCronBindings(bindings([]), async () => {
      expect(getCronBindings()?.mcpServerIds).toEqual([])
    })
    expect(getCronBindings()).toBeUndefined()
  })
})
