import { describe, expect, test } from 'bun:test'

describe('config env booleans', () => {
  test('parses ALLOW_SIGNUP=false string as false', async () => {
    const prev = process.env.ALLOW_SIGNUP
    process.env.ALLOW_SIGNUP = 'false'
    const { loadConfig } = await import('../src/config')
    expect(loadConfig().ALLOW_SIGNUP).toBe(false)
    process.env.ALLOW_SIGNUP = prev
  })

  test('parses AUTO_APPROVE_ALL=true string as true', async () => {
    const prev = process.env.AUTO_APPROVE_ALL
    process.env.AUTO_APPROVE_ALL = 'true'
    const { loadConfig } = await import('../src/config')
    expect(loadConfig().AUTO_APPROVE_ALL).toBe(true)
    process.env.AUTO_APPROVE_ALL = prev
  })
})
