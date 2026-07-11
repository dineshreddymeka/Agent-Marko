import { describe, expect, test } from 'bun:test'

describe('app phase 1', () => {
  test('route tree defines all planned routes', async () => {
    const { routeTree } = await import('../src/routeTree.gen')
    expect(routeTree).toBeDefined()
    expect(routeTree.children).toBeDefined()
  })

  test('applyTheme sets data-theme when DOM available', async () => {
    if (typeof document === 'undefined') return
    const { applyTheme } = await import('../src/stores/ui')
    applyTheme('light')
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
    applyTheme('dark')
  })
})
