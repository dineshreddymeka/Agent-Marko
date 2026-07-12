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

  test('AUTO_APPROVE_ALL defaults true when unset', async () => {
    const prev = process.env.AUTO_APPROVE_ALL
    delete process.env.AUTO_APPROVE_ALL
    const { loadConfig } = await import('../src/config')
    expect(loadConfig().AUTO_APPROVE_ALL).toBe(true)
    process.env.AUTO_APPROVE_ALL = prev
  })

  test('INDEXER_ENABLED defaults true and accepts false', async () => {
    const prev = process.env.INDEXER_ENABLED
    delete process.env.INDEXER_ENABLED
    const { loadConfig } = await import('../src/config')
    expect(loadConfig().INDEXER_ENABLED).toBe(true)
    process.env.INDEXER_ENABLED = 'false'
    expect(loadConfig().INDEXER_ENABLED).toBe(false)
    process.env.INDEXER_ENABLED = prev
  })
})
