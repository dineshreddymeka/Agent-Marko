import { describe, expect, test } from 'bun:test'
import { getHealthResponse } from '../src/health'

describe('health', () => {
  test('returns ok with version and db flag', async () => {
    const res = await getHealthResponse()
    expect(res.ok).toBe(true)
    expect(res.version).toBe('0.1.0')
    expect(typeof res.db).toBe('boolean')
  })
})
