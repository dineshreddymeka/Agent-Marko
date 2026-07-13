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

  test('INDEXER_ENABLED defaults true and accepts false', async () => {
    const prev = process.env.INDEXER_ENABLED
    delete process.env.INDEXER_ENABLED
    const { loadConfig } = await import('../src/config')
    expect(loadConfig().INDEXER_ENABLED).toBe(true)
    process.env.INDEXER_ENABLED = 'false'
    expect(loadConfig().INDEXER_ENABLED).toBe(false)
    process.env.INDEXER_ENABLED = prev
  })

  test('infers HERMES_AGENT_LLM_URL from keyed non-bridge LLM_BASE_URL', async () => {
    const prevAgent = process.env.HERMES_AGENT_LLM_URL
    const prevBase = process.env.LLM_BASE_URL
    const prevKey = process.env.LLM_API_KEY
    delete process.env.HERMES_AGENT_LLM_URL
    process.env.LLM_BASE_URL = 'https://api.openai.com/v1'
    process.env.LLM_API_KEY = 'sk-test'
    const { loadConfig } = await import('../src/config')
    expect(loadConfig().HERMES_AGENT_LLM_URL).toBe('https://api.openai.com/v1')
    process.env.HERMES_AGENT_LLM_URL = prevAgent
    process.env.LLM_BASE_URL = prevBase
    process.env.LLM_API_KEY = prevKey
  })

  test('does not infer agent URL from lm-bridge base', async () => {
    const prevAgent = process.env.HERMES_AGENT_LLM_URL
    const prevBase = process.env.LLM_BASE_URL
    const prevKey = process.env.LLM_API_KEY
    delete process.env.HERMES_AGENT_LLM_URL
    process.env.LLM_BASE_URL = 'http://127.0.0.1:3456/v1'
    process.env.LLM_API_KEY = 'local'
    const { loadConfig } = await import('../src/config')
    expect(loadConfig().HERMES_AGENT_LLM_URL).toBe('')
    process.env.HERMES_AGENT_LLM_URL = prevAgent
    process.env.LLM_BASE_URL = prevBase
    process.env.LLM_API_KEY = prevKey
  })
})
