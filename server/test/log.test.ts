import { describe, expect, test } from 'bun:test'
import { redact, serializeError } from '../src/log'

describe('logger helpers', () => {
  test('redacts sensitive keys', () => {
    const out = redact({
      api_key: 'sk-secret',
      Authorization: 'Bearer x',
      nested: { token: 'abc', ok: 1 },
    }) as Record<string, unknown>
    expect(out.api_key).toBe('[REDACTED]')
    expect(out.Authorization).toBe('[REDACTED]')
    expect((out.nested as Record<string, unknown>).token).toBe('[REDACTED]')
    expect((out.nested as Record<string, unknown>).ok).toBe(1)
  })

  test('serializeError includes stack', () => {
    const err = new Error('boom')
    const ser = serializeError(err)
    expect(ser.error).toBe('boom')
    expect(ser.stack).toContain('Error: boom')
  })
})
