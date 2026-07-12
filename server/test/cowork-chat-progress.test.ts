import { describe, expect, test } from 'bun:test'
import {
  createDeltaThrottler,
  formatCoworkProgressLine,
  mapCoworkEventToProgress,
} from '../src/cowork/chat-progress'

describe('mapCoworkEventToProgress', () => {
  const base = { taskId: 't-20260712-001', coworkSessionId: 'sess-1' }

  test('maps session.started / end / error / text / tool events', () => {
    expect(mapCoworkEventToProgress({ type: 'session.started', sessionId: 'sess-1' }, base)).toEqual(
      {
        taskId: 't-20260712-001',
        coworkSessionId: 'sess-1',
        phase: 'started',
      },
    )
    expect(
      mapCoworkEventToProgress(
        { type: 'agent.text_delta', sessionId: 'sess-1', text: 'hi' },
        base,
      ),
    ).toEqual({
      taskId: 't-20260712-001',
      coworkSessionId: 'sess-1',
      phase: 'delta',
      text: 'hi',
    })
    expect(
      mapCoworkEventToProgress(
        { type: 'agent.tool_start', sessionId: 'sess-1', tool: 'bash', input: { cmd: 'ls' } },
        base,
      )?.phase,
    ).toBe('tool')
    expect(
      mapCoworkEventToProgress(
        { type: 'session.end', sessionId: 'sess-1', result: 'ok' },
        base,
      ),
    ).toMatchObject({ phase: 'ended', ok: true })
    expect(
      mapCoworkEventToProgress(
        { type: 'error', sessionId: 'sess-1', message: 'boom' },
        base,
      ),
    ).toMatchObject({ phase: 'error', ok: false, text: 'boom' })
  })

  test('ignores unknown / empty delta events', () => {
    expect(mapCoworkEventToProgress({ type: 'stdio.ready' }, base)).toBeNull()
    expect(
      mapCoworkEventToProgress({ type: 'agent.text_delta', sessionId: 'sess-1', text: '' }, base),
    ).toBeNull()
  })
})

describe('createDeltaThrottler', () => {
  test('coalesces rapid pushes then flushes', async () => {
    const flushed: string[] = []
    const t = createDeltaThrottler((text) => flushed.push(text), 30)
    t.push('a')
    t.push('b')
    t.push('c')
    expect(flushed).toEqual([])
    await new Promise((r) => setTimeout(r, 50))
    expect(flushed).toEqual(['abc'])
    t.push('d')
    t.flushNow()
    expect(flushed).toEqual(['abc', 'd'])
  })
})

describe('formatCoworkProgressLine', () => {
  test('formats each phase', () => {
    expect(
      formatCoworkProgressLine({ taskId: 't-1', phase: 'started' }),
    ).toContain('started')
    expect(
      formatCoworkProgressLine({ taskId: 't-1', phase: 'delta', text: ' hello ' }),
    ).toBe('hello')
    expect(
      formatCoworkProgressLine({ taskId: 't-1', phase: 'tool', tool: 'bash' }),
    ).toContain('bash')
    expect(
      formatCoworkProgressLine({ taskId: 't-1', phase: 'ended' }),
    ).toContain('finished')
    expect(
      formatCoworkProgressLine({ taskId: 't-1', phase: 'error', text: 'nope' }),
    ).toBe('nope')
  })
})
