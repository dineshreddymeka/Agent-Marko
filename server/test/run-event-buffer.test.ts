import { describe, expect, test } from 'bun:test'
import {
  bufferRunEvent,
  getBufferedRunEvents,
  listBufferedRuns,
} from '../src/agui/run-event-buffer'

describe('run event buffer', () => {
  test('stores and lists buffered run events', () => {
    const runId = '00000000-0000-4000-8000-000000000001'
    bufferRunEvent({
      runId,
      sessionId: '00000000-0000-4000-8000-000000000002',
      seq: 1,
      eventType: 'RUN_STARTED',
      payload: { type: 'RUN_STARTED' },
    })
    bufferRunEvent({
      runId,
      sessionId: '00000000-0000-4000-8000-000000000002',
      seq: 2,
      eventType: 'TEXT_MESSAGE_CONTENT',
      payload: { type: 'TEXT_MESSAGE_CONTENT', delta: 'hi' },
    })

    const runs = listBufferedRuns()
    expect(runs.some((r) => r.runId === runId)).toBe(true)
    expect(getBufferedRunEvents(runId).length).toBeGreaterThanOrEqual(2)
  })
})
