import { describe, expect, test } from 'bun:test'
import {
  createDeltaThrottler,
  formatCoworkProgressLine,
  mapCoworkEventToProgress,
} from '../src/cowork/chat-progress'

describe('cowork chat-progress mapping', () => {
  test('maps session.started / tool / end / error', () => {
    expect(
      mapCoworkEventToProgress(
        { type: 'session.started', sessionId: 's1' },
        { taskId: 't-1' },
      ),
    ).toEqual({
      taskId: 't-1',
      coworkSessionId: 's1',
      phase: 'started',
    })

    expect(
      mapCoworkEventToProgress(
        { type: 'agent.tool_start', sessionId: 's1', tool: 'Read', input: { path: 'a' } },
        { taskId: 't-1', coworkSessionId: 's1' },
      ),
    ).toMatchObject({ phase: 'tool', tool: 'Read' })

    expect(
      mapCoworkEventToProgress(
        { type: 'session.end', sessionId: 's1', result: 'done' },
        { taskId: 't-1', coworkSessionId: 's1' },
      ),
    ).toMatchObject({ phase: 'ended', ok: true })

    expect(
      mapCoworkEventToProgress(
        { type: 'error', sessionId: 's1', message: 'boom' },
        { taskId: 't-1', coworkSessionId: 's1' },
      ),
    ).toMatchObject({ phase: 'error', text: 'boom', ok: false })
  })

  test('ignores unknown and empty delta', () => {
    expect(
      mapCoworkEventToProgress({ type: 'stdio.ready' }, { taskId: 't-1' }),
    ).toBeNull()
    expect(
      mapCoworkEventToProgress(
        { type: 'agent.text_delta', text: '' },
        { taskId: 't-1' },
      ),
    ).toBeNull()
  })

  test('formatCoworkProgressLine', () => {
    expect(
      formatCoworkProgressLine({ taskId: 't-1', phase: 'started' }),
    ).toContain('t-1')
    expect(
      formatCoworkProgressLine({
        taskId: 't-1',
        phase: 'tool',
        tool: 'Write',
      }),
    ).toContain('Write')
  })

  test('delta throttler coalesces', async () => {
    const lines: string[] = []
    const t = createDeltaThrottler((text) => lines.push(text), 30)
    t.push('a')
    t.push('b')
    expect(lines).toEqual([])
    await new Promise((r) => setTimeout(r, 50))
    expect(lines).toEqual(['ab'])
    t.push('c')
    t.flushNow()
    expect(lines).toEqual(['ab', 'c'])
  })
})
