import { describe, expect, test } from 'bun:test'
import { runCodeInSandbox } from '../src/compute/pool'

describe('run_code sandbox', () => {
  test('executes simple expression', async () => {
    const result = await runCodeInSandbox('return 1 + 2')
    expect(result).toBe(3)
  })

  test('respects abort signal', async () => {
    const controller = new AbortController()
    const pending = runCodeInSandbox('await Bun.sleep(60_000); return 1', controller.signal)
    controller.abort()
    const result = await pending
    expect(result).toHaveProperty('error')
  })
})
