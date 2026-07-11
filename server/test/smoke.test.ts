import { describe, expect, test } from 'bun:test'
import { encodeAguiEvent } from '../src/agui/encoder'
import { EventType } from '@ag-ui/core'

describe('health', () => {
  test('encodeAguiEvent produces SSE data line', () => {
    const frame = encodeAguiEvent({
      type: EventType.RUN_STARTED,
      threadId: '00000000-0000-4000-8000-000000000001',
      runId: '00000000-0000-4000-8000-000000000002',
    })
    expect(frame.startsWith('data: ')).toBe(true)
    expect(frame.endsWith('\n\n')).toBe(true)
    expect(frame).toContain('RUN_STARTED')
  })
})

describe('schema module', () => {
  test('exports all planned tables', async () => {
    const { schema } = await import('../src/db/schema')
    expect(schema.sessions).toBeDefined()
    expect(schema.messages).toBeDefined()
    expect(schema.memory).toBeDefined()
    expect(schema.skills).toBeDefined()
    expect(schema.mcpServers).toBeDefined()
    expect(schema.cronJobs).toBeDefined()
    expect(schema.cronRuns).toBeDefined()
    expect(schema.profiles).toBeDefined()
    expect(schema.settings).toBeDefined()
    expect(schema.runEvents).toBeDefined()
  })
})

describe('provider registry', () => {
  test('registers native, agui-remote, hermes-python', async () => {
    const { listProviders, getProvider } = await import('../src/agent/provider')
    await import('../src/agent/providers/native')
    await import('../src/agent/providers/agui-remote')
    await import('../src/agent/providers/hermes-python')
    const ids = listProviders()
    expect(ids).toContain('native')
    expect(ids).toContain('agui-remote')
    expect(ids).toContain('hermes-python')
    expect(getProvider('native')?.id).toBe('native')
  })
})

describe('skill parser', () => {
  test('parses SKILL.md frontmatter', async () => {
    const { parseSkillMarkdown } = await import('../src/skills/loader')
    const md = `---
name: test-skill
description: A test skill
triggers: ["deploy","release"]
---

# Instructions

Do the thing.
`
    const parsed = parseSkillMarkdown(md, '/skills/test/SKILL.md')
    expect(parsed).not.toBeNull()
    expect(parsed!.name).toBe('test-skill')
    expect(parsed!.description).toBe('A test skill')
    expect(parsed!.triggers).toEqual(['deploy', 'release'])
    expect(parsed!.bodyMd).toContain('# Instructions')
  })

  test('returns null for invalid skill files', async () => {
    const { parseSkillMarkdown } = await import('../src/skills/loader')
    expect(parseSkillMarkdown('# No frontmatter')).toBeNull()
  })
})
