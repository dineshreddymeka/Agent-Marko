/**
 * SoT coverage smoke — proves modules required by BMC HERMES-UI-PLAN.md are importable
 * and expose expected surfaces (tools, errors, providers, catalog, compose image).
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { HermesCustomEvents, HERMES_CATALOG_IDS } from '@hermes/shared'
import {
  HermesError,
  LlmError,
  ToolError,
  ProviderError,
  DbError,
} from '../src/errors'

const root = join(import.meta.dir, '../..')

describe('SoT: docker Postgres 17', () => {
  test('compose pins pgvector 0.8.5-pg17 and data volume path', () => {
    const compose = readFileSync(join(root, 'docker-compose.yml'), 'utf8')
    expect(compose).toContain('pgvector/pgvector:0.8.5-pg17')
    expect(compose).toContain('/var/lib/postgresql/data')
    expect(compose).not.toContain('0.8.5-pg18')
  })
})

describe('SoT: typed error taxonomy', () => {
  test('exports Llm/Tool/Provider/Db errors with codes', () => {
    expect(new LlmError('x').code).toBe('LLM_ERROR')
    expect(new ToolError('x').code).toBe('TOOL_ERROR')
    expect(new ProviderError('x').code).toBe('PROVIDER_ERROR')
    expect(new DbError('x').code).toBe('DB_ERROR')
    expect(new HermesError('VALIDATION_ERROR', 'bad', 400).status).toBe(400)
  })
})

describe('SoT: custom AG-UI + A2UI catalog', () => {
  test('Hermes custom events include SoT names', () => {
    expect(HermesCustomEvents.CONTEXT).toBe('hermes.context')
    expect(HermesCustomEvents.CRON_FIRED).toBe('hermes.cron.fired')
    expect(HermesCustomEvents.SKILL_LEARNED).toBe('hermes.skill.learned')
    expect(HermesCustomEvents.TITLE).toBe('hermes.title')
    expect(HermesCustomEvents.A2UI_MESSAGE).toBe('a2ui.message')
  })

  test('custom A2UI catalog has six Hermes widgets', () => {
    expect(HERMES_CATALOG_IDS).toEqual([
      'hermes:SkillCard',
      'hermes:MemoryEntryEditor',
      'hermes:CronSchedulePicker',
      'hermes:FileDiff',
      'hermes:DocumentRequestForm',
      'hermes:FormRequestForm',
    ])
  })
})

describe('SoT: native tool registry', () => {
  test('registers dangerous + safe tools from SoT tool set', async () => {
    await import('../src/agent/tools/shell')
    await import('../src/agent/tools/files')
    await import('../src/agent/tools/web')
    await import('../src/agent/tools/memory')
    await import('../src/agent/tools/skills')
    await import('../src/agent/tools/cron')
    await import('../src/agent/tools/a2ui')
    await import('../src/agent/tools/code')
    await import('../src/agent/tools/delegate_to_agent')

    const { listTools, isDangerous, getTool } = await import('../src/agent/tools/registry')
    const names = listTools().map((t) => t.name)

    for (const required of [
      'run_shell',
      'read_file',
      'write_file',
      'list_dir',
      'web_search',
      'fetch_url',
      'memory_save',
      'memory_search',
      'skill_save',
      'skill_search',
      'cron_create',
      'cron_list',
      'cron_delete',
      'cron_form_show',
      'document_form_show',
      'form_request_show',
      'a2ui_render',
      'run_code',
      'delegate_to_agent',
    ]) {
      expect(names).toContain(required)
      expect(getTool(required)).toBeDefined()
    }

    expect(isDangerous('run_shell')).toBe(true)
    expect(isDangerous('write_file')).toBe(true)
    expect(isDangerous('read_file')).toBe(false)
  })
})

describe('SoT: auth + compute surfaces', () => {
  test('compute pool exports', async () => {
    const pool = await import('../src/compute/pool')
    expect(typeof pool.runComputeTask).toBe('function')
    expect(typeof pool.runCodeInSandbox).toBe('function')
    expect(typeof pool.getComputePoolStatus).toBe('function')
  })

  test('auth guard surfaces', async () => {
    const auth = await import('../src/auth/index')
    expect(typeof auth.guardRequest).toBe('function')
    expect(typeof auth.requireAuth).toBe('function')
    expect(auth.auth).toBeDefined()
  })
})

describe('SoT: MCP manager', () => {
  test('mcp manager module loads', async () => {
    const mcp = await import('../src/mcp/manager')
    expect(mcp).toBeDefined()
  })
})
