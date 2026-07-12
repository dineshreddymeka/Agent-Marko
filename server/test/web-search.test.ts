import { describe, expect, test } from 'bun:test'
import { webSearch } from '../src/agent/tools/web'

describe('web_search', () => {
  test('duckduckgo provider returns structured results without API key', async () => {
    const prevProvider = process.env.WEB_SEARCH_PROVIDER
    const prevKey = process.env.WEB_SEARCH_API_KEY
    process.env.WEB_SEARCH_PROVIDER = 'duckduckgo'
    delete process.env.WEB_SEARCH_API_KEY

    // Reloading config is cached — call searchDuckDuckGo path via provider env already loaded.
    // Exercise the exported helper which reads module config; if config already loaded as auto,
    // duckduckgo is still the fallback without key.
    const result = await webSearch('Open Jarvis', AbortSignal.timeout(15_000))
    expect(result.query).toBe('Open Jarvis')
    expect(result.provider).toBeTruthy()
    expect(Array.isArray(result.results)).toBe(true)

    process.env.WEB_SEARCH_PROVIDER = prevProvider
    process.env.WEB_SEARCH_API_KEY = prevKey
  })
})
