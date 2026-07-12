/**
 * Mock Chrome MCP client-side contract tests (tool handlers without live server).
 * Complements server/scripts/mock-mcp-chrome.ts used for Connect/Test in the UI.
 */
import { describe, expect, test } from 'bun:test'
import { getTool } from '../src/agent/tools/registry'
import '../src/agent/tools/chrome'
import { resetChromeSession } from '../src/agent/tools/chrome'

describe('chrome tools + MCP mock contract', () => {
  test('chrome tool chain open → content → screenshot', async () => {
    resetChromeSession()
    const ctx = {
      sessionId: 's',
      runId: 'r',
      signal: new AbortController().signal,
    }
    process.env.HERMES_CHROME_MOCK = '1'

    const open = await getTool('chrome_open')!.execute(
      { url: 'https://example.com/docs/policy' },
      ctx,
    )
    expect((open as { ok: boolean }).ok).toBe(true)

    const content = await getTool('chrome_get_content')!.execute({}, ctx)
    expect((content as { text: string }).text.length).toBeGreaterThan(20)

    const shot = await getTool('chrome_screenshot')!.execute({ name: 'policy' }, ctx)
    expect((shot as { relativePath: string }).relativePath).toContain('chrome-captures/')
  })

  test('chrome_open rejects non-http schemes', async () => {
    resetChromeSession()
    const ctx = {
      sessionId: 's',
      runId: 'r',
      signal: new AbortController().signal,
    }
    await expect(
      getTool('chrome_open')!.execute({ url: 'file:///etc/passwd' }, ctx),
    ).rejects.toThrow(/http/i)
  })
})
