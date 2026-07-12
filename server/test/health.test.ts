import { describe, expect, test } from 'bun:test'
import { getHealthResponse } from '../src/health'

describe('health', () => {
  test('returns ok with version and db flag', async () => {
    const res = await getHealthResponse()
    expect(res.ok).toBe(true)
    expect(res.version).toBe('0.2.0')
    expect(typeof res.db).toBe('boolean')
    expect(res.llm).toBeTruthy()
    expect(typeof res.llm.mock).toBe('boolean')
    expect(res.llm.mode === 'mock' || res.llm.mode === 'live').toBe(true)
    // Public payload must not expose LLM baseUrl (that lives on /api/debug/health).
    expect('baseUrl' in res.llm).toBe(false)
    expect(Array.isArray(res.oauthProviders)).toBe(true)
  })
})
