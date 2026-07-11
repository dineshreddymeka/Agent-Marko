import { test, expect } from '@playwright/test'

test.describe('Hermes UI smoke', () => {
  test('loads chat shell', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('main')).toBeVisible()
    await expect(page.getByPlaceholder('Message Hermes… (/ for commands)')).toBeVisible()
  })

  test('opens command palette with Ctrl+K', async ({ page }) => {
    await page.goto('/')
    await page.keyboard.press('Control+k')
    await expect(page.getByPlaceholder('Type a command or search…')).toBeVisible()
  })

  test('navigates to settings panel', async ({ page }) => {
    await page.goto('/panel/settings')
    await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'debug' })).toBeVisible()
  })
})
