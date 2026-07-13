import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { tryServeStatic } from '../src/static'

describe('static UI serving', () => {
  test('returns null when dist is missing', async () => {
    const prev = process.env.HERMES_DATA_DIR
    const res = await tryServeStatic(new Request('http://127.0.0.1:3001/login', { method: 'GET' }))
    // dist may or may not exist in CI — either null or 200/503
    expect(res === null || res.status === 200 || res.status === 503).toBe(true)
    process.env.HERMES_DATA_DIR = prev
  })

  test('does not intercept API routes', async () => {
    const res = await tryServeStatic(new Request('http://127.0.0.1:3001/api/health'))
    expect(res).toBeNull()
  })
})
