/**
 * Run all phase verifiers that work in the current environment.
 * Skips Docker-dependent Phase 2 when Docker is unavailable.
 */
import { join } from 'node:path'
import { resolveBunExecutable } from './lib/bun-path'
import { isDockerDaemonReady, resolveDocker, dockerPathEnv } from './lib/docker-path'

const root = import.meta.dir.replace(/[/\\]scripts$/, '')
const bun = resolveBunExecutable()
const scriptEnv = { ...process.env, ...dockerPathEnv() }

async function runScript(name: string, extraArgs: string[] = []): Promise<number> {
  const proc = Bun.spawn([bun, `scripts/${name}`, ...extraArgs], {
    cwd: root,
    stdout: 'inherit',
    stderr: 'inherit',
    env: scriptEnv,
  })
  return proc.exited
}

async function main() {
  console.log('=== verify:all ===\n')

  console.log('--- Phase 1 ---')
  if ((await runScript('verify-phase1.ts')) !== 0) process.exit(1)

  console.log('\n--- Unit tests ---')
  const testProc = Bun.spawn([bun, 'test', 'app', 'server', 'packages/shared'], {
    cwd: root,
    stdout: 'inherit',
    stderr: 'inherit',
  })
  if ((await testProc.exited) !== 0) process.exit(1)

  console.log('\n--- Phase 3 (mock AG-UI) ---')
  if ((await runScript('verify-phase3.ts')) !== 0) process.exit(1)

  console.log('\n--- Phase 3 LLM (optional) ---')
  const llm = await runScript('verify-phase3-llm.ts')
  if (llm !== 0) console.warn('Real LLM verify skipped or failed (set LLM_API_KEY)')

  console.log('\n--- Offline debug buffer smoke ---')
  if ((await runScript('verify-offline-debug.ts')) !== 0) process.exit(1)

  console.log('\n--- A2UI demo scenarios ---')
  if ((await runScript('verify-a2ui-demos.ts')) !== 0) process.exit(1)

  const docker = await resolveDocker()
  if (docker && (await isDockerDaemonReady(docker))) {
    console.log('\n--- Phase 2 (Docker + Postgres) ---')
    if ((await runScript('verify-phase2.ts', ['--integration'])) !== 0) process.exit(1)
  } else if (docker) {
    console.log('\n--- Phase 2 skipped (Docker installed but daemon not running) ---')
    console.log('Start Docker Desktop (fix WSL if needed), then: bun run verify:phase2')
  } else {
    console.log('\n--- Phase 2 skipped (Docker not found) ---')
    console.log('Install Docker Desktop, then: bun run verify:phase2')
  }

  console.log('\n--- Playwright smoke ---')
  const e2eProc = Bun.spawn([bun, 'run', 'test:e2e'], {
    cwd: root,
    stdout: 'inherit',
    stderr: 'inherit',
    env: { ...process.env, PLAYWRIGHT_SKIP_WEBSERVER: process.env.PLAYWRIGHT_SKIP_WEBSERVER ?? '' },
  })
  if ((await e2eProc.exited) !== 0) {
    console.warn('Playwright failed — run: bunx playwright install chromium')
    process.exit(1)
  }

  console.log('\n--- Lighthouse (optional threshold) ---')
  const lh = await runScript('verify-lighthouse.ts')
  if (lh !== 0) {
    console.warn('Lighthouse verify failed (non-fatal in verify:all unless CI sets LIGHTHOUSE_STRICT=1)')
    if (process.env.LIGHTHOUSE_STRICT === '1') process.exit(1)
  }

  console.log('\n=== verify:all complete ===')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
