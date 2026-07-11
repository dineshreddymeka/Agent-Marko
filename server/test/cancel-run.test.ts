import { describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { cancelRun, registerRun } from '../src/agui/runs'
import type { RunAgentInput } from '@ag-ui/core'

describe('run cancellation', () => {
  test('cancelRun aborts registered run', () => {
    const input: RunAgentInput = {
      threadId: randomUUID(),
      runId: randomUUID(),
      messages: [],
      tools: [],
      state: {},
      context: [],
    }
    const run = registerRun(input)
    expect(run.controller.signal.aborted).toBe(false)
    expect(cancelRun(input.runId)).toBe(true)
    expect(run.controller.signal.aborted).toBe(true)
    expect(cancelRun(input.runId)).toBe(false)
  })
})
