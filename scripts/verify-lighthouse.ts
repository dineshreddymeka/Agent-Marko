/**
 * Phase 7 Lighthouse check on the built app shell (static preview).
 * Requires Chrome/Chromium (Playwright install is enough).
 *
 * Pass threshold via LIGHTHOUSE_PERF_MIN (default 90 — populated session may score lower).
 */
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { resolveBunExecutable } from './lib/bun-path'

const root = import.meta.dir.replace(/[/\\]scripts$/, '')
const bun = resolveBunExecutable()
const distIndex = join(root, 'app', 'dist', 'index.html')
const perfMin = Number(process.env.LIGHTHOUSE_PERF_MIN ?? 90)
const tmpDir = join(root, '.tmp')

async function isPortServing(url: string): Promise<boolean> {
  try {
    const res = await fetch(url)
    return res.ok
  } catch {
    return false
  }
}

async function resolvePreviewPort(preferred: number): Promise<number> {
  if (process.env.LIGHTHOUSE_PORT) return preferred
  for (let port = preferred; port < preferred + 10; port++) {
    const url = `http://127.0.0.1:${port}/`
    if (await isPortServing(url)) return port
    try {
      const proc = Bun.spawn([bun, 'x', 'vite', 'preview', '--port', String(port), '--host', '127.0.0.1', '--strictPort'], {
        cwd: join(root, 'app'),
        stdout: 'pipe',
        stderr: 'pipe',
      })
      await Bun.sleep(800)
      if (await isPortServing(url)) {
        proc.kill()
        return port
      }
      proc.kill()
    } catch {
      /* try next port */
    }
  }
  return preferred
}

async function run(cmd: string[], opts?: { cwd?: string; env?: Record<string, string> }): Promise<number> {
  const proc = Bun.spawn(cmd, {
    cwd: opts?.cwd ?? root,
    stdout: 'inherit',
    stderr: 'inherit',
    env: { ...process.env, ...opts?.env },
  })
  return proc.exited
}

async function waitForUrl(url: string, timeoutMs = 30_000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url)
      if (res.ok) return
    } catch {
      /* retry */
    }
    await Bun.sleep(400)
  }
  throw new Error(`Server not ready: ${url}`)
}

async function main() {
  if (!existsSync(distIndex)) {
    console.log('Building app…')
    if ((await run([bun, 'run', '--filter', 'app', 'build'])) !== 0) process.exit(1)
  }

  const preferredPort = Number(process.env.LIGHTHOUSE_PORT ?? 4173)
  const previewPort = await resolvePreviewPort(preferredPort)
  const target = `http://127.0.0.1:${previewPort}/`

  console.log(`Starting vite preview on :${previewPort}`)
  const alreadyServing = await isPortServing(target)
  const preview = alreadyServing
    ? null
    : Bun.spawn([bun, 'x', 'vite', 'preview', '--port', String(previewPort), '--host', '127.0.0.1', '--strictPort'], {
        cwd: join(root, 'app'),
        stdout: 'pipe',
        stderr: 'inherit',
      })

  mkdirSync(tmpDir, { recursive: true })
  const lighthouseEnv = {
    ...process.env,
    TEMP: tmpDir,
    TMP: tmpDir,
    TMPDIR: tmpDir,
  }
  try {
    await waitForUrl(target)

    const outPath = join(root, '.lighthouse-report.json')
    const chromePath =
      process.env.CHROME_PATH ??
      join(process.env.USERPROFILE ?? '', 'AppData', 'Local', 'ms-playwright', 'chromium-1169', 'chrome-win', 'chrome.exe')

    const lhArgs = [
      'x',
      'lighthouse',
      target,
      '--output=json',
      `--output-path=${outPath}`,
      '--chrome-flags=--headless --no-sandbox',
      '--only-categories=performance',
      '--quiet',
    ]
    if (existsSync(chromePath)) {
      lhArgs.push(`--chrome-path=${chromePath}`)
    }

    const lhCode = await run([bun, ...lhArgs], { env: lighthouseEnv })
    if (lhCode !== 0) {
      console.warn('Lighthouse CLI failed — install Chrome or run: bunx playwright install chromium')
      process.exit(1)
    }

    const report = (await Bun.file(outPath).json()) as {
      categories?: { performance?: { score?: number } }
    }
    const score = Math.round((report.categories?.performance?.score ?? 0) * 100)
    console.log(`Lighthouse performance score: ${score} (min ${perfMin})`)

    if (score < perfMin) {
      console.error(`Performance ${score} below threshold ${perfMin}`)
      process.exit(1)
    }

    console.log('Phase 7 Lighthouse verify: complete')
  } finally {
    preview?.kill()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
