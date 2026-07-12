import { test, expect, type Page } from '@playwright/test'

const PANELS = [
  { path: '/panel/sessions', heading: 'Sessions' },
  { path: '/panel/workspace', heading: 'Workspace' },
  { path: '/panel/skills', heading: 'Skills' },
  { path: '/panel/memory', heading: 'Memory' },
  { path: '/panel/connections', heading: 'MCP' },
  { path: '/panel/cron', heading: 'Cowork' },
  { path: '/panel/profiles', heading: 'Profiles' },
  { path: '/panel/settings', heading: 'Settings' },
] as const

/** Wait for hydrated shell, then open palette (Ctrl/Meta+K). */
async function openCommandPalette(page: Page) {
  await page.goto('/')
  await expect(page.getByPlaceholder('Message Open Jarvis… (/ for commands)')).toBeVisible()
  await page.getByRole('main').click()
  const isMac = process.platform === 'darwin'
  await page.keyboard.press(isMac ? 'Meta+k' : 'Control+k')
  await expect(page.getByTestId('command-palette')).toBeVisible({ timeout: 10_000 })
}

test.describe('Open Jarvis smoke', () => {
  test('loads chat shell', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('main')).toBeVisible()
    await expect(page.getByPlaceholder('Message Open Jarvis… (/ for commands)')).toBeVisible()
  })

  test('opens command palette with Ctrl+K', async ({ page }) => {
    await openCommandPalette(page)
    await expect(page.getByPlaceholder('Type a command or search…')).toBeVisible()
  })

  test('navigates to settings panel with debug tab', async ({ page }) => {
    await page.goto('/panel/settings')
    await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Debug' })).toBeVisible()
  })

  test('command palette documents keyboard shortcuts', async ({ page }) => {
    await openCommandPalette(page)
    await expect(page.getByRole('option', { name: 'New session with profile…' })).toBeVisible()
    await expect(page.getByText('Keyboard shortcuts')).toBeVisible()
    await expect(page.getByRole('option', { name: 'New session', exact: true })).toBeVisible()
  })

  for (const panel of PANELS) {
    test(`SoT panel route ${panel.path}`, async ({ page }) => {
      await page.goto(panel.path)
      await expect(page.getByRole('heading', { level: 1, name: panel.heading })).toBeVisible()
    })
  }
})
