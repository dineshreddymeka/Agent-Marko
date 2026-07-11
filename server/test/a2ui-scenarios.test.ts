import { describe, expect, test } from 'bun:test'
import { resolveMockScript } from '../src/agent/mock-scenarios'

describe('mock A2UI scenarios', () => {
  test('a2ui-cron first turn requests a2ui_render', () => {
    process.env.HERMES_MOCK_SCENARIO = 'a2ui-cron'
    const script = resolveMockScript([{ role: 'user', content: 'setup cron' }])
    expect(script.toolCalls?.[0]?.name).toBe('a2ui_render')
    delete process.env.HERMES_MOCK_SCENARIO
  })

  test('a2ui-cron second turn completes without tools', () => {
    process.env.HERMES_MOCK_SCENARIO = 'a2ui-cron'
    const script = resolveMockScript([
      { role: 'user', content: 'setup cron' },
      { role: 'tool', content: '{}', tool_call_id: '1' },
    ])
    expect(script.toolCalls?.length ?? 0).toBe(0)
    expect(script.content?.[0]).toContain('Cron')
    delete process.env.HERMES_MOCK_SCENARIO
  })

  test('a2ui-memory renders MemoryEntryEditor payload', () => {
    process.env.HERMES_MOCK_SCENARIO = 'a2ui-memory'
    const script = resolveMockScript([{ role: 'user', content: 'memory' }])
    const payload = script.toolCalls?.[0]?.arguments.payload as {
      component?: { type?: string }
    }
    expect(payload?.component?.type).toBe('hermes:MemoryEntryEditor')
    delete process.env.HERMES_MOCK_SCENARIO
  })

  test('a2ui-skills renders SkillCard payload', () => {
    process.env.HERMES_MOCK_SCENARIO = 'a2ui-skills'
    const script = resolveMockScript([{ role: 'user', content: 'skills' }])
    const payload = script.toolCalls?.[0]?.arguments.payload as {
      component?: { type?: string }
    }
    expect(payload?.component?.type).toBe('hermes:SkillCard')
    delete process.env.HERMES_MOCK_SCENARIO
  })
})
