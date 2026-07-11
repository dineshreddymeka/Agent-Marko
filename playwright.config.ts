import { defineConfig, devices } from '@playwright/test'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

function resolveBun(): string {
  if (process.env.BUN_INSTALL) {
    const candidate = join(process.env.BUN_INSTALL, 'bin', 'bun.exe')
    if (existsSync(candidate)) return candidate
  }
  const local = join(process.env.USERPROFILE ?? process.env.HOME ?? '', '.bun', 'bin', 'bun.exe')
  if (existsSync(local)) return local
  return 'bun'
}

const bun = resolveBun()

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'list',
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:5173',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: process.env.PLAYWRIGHT_SKIP_WEBSERVER
    ? undefined
    : {
        command: `"${bun}" run dev`,
        url: 'http://127.0.0.1:5173',
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
})
