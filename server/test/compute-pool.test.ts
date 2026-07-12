import { describe, expect, test } from 'bun:test'
import { getComputePoolStatus, runComputeTask } from '../src/compute/pool'

describe('compute worker pool', () => {
  test('pool reports ready workers', () => {
    const status = getComputePoolStatus()
    expect(status.status).toBe('ready')
    expect(status.workers).toBeGreaterThanOrEqual(1)
  })

  test('echo task round-trips via worker', async () => {
    const result = await runComputeTask({ type: 'echo', payload: { hello: 'open-jarvis' } })
    expect(result).toEqual({ hello: 'open-jarvis' })
  })

  test('hash task returns sha256 hex', async () => {
    const result = await runComputeTask({ type: 'hash', payload: 'open-jarvis' })
    expect(typeof result).toBe('string')
    expect(String(result)).toMatch(/^[a-f0-9]{64}$/)
  })
})
