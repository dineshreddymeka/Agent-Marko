import { readFileSync } from 'node:fs'

const root = import.meta.dir.replace(/[/\\]scripts$/, '')

const bunExe = process.execPath.toLowerCase().includes('bun')
  ? process.execPath
  : process.platform === 'win32'
    ? `${process.env.USERPROFILE ?? process.env.HOME ?? ''}/.bun/bin/bun.exe`
    : 'bun'

/** Force-load repo-root `.env` so the server child (cwd=server/) always sees LLM mode. */
function loadRootEnv(): Record<string, string> {
  const out: Record<string, string> = {}
  try {
    const text = readFileSync(`${root}/.env`, 'utf8')
    for (const line of text.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eq = trimmed.indexOf('=')
      if (eq <= 0) continue
      const key = trimmed.slice(0, eq).trim()
      let value = trimmed.slice(eq + 1).trim()
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1)
      }
      out[key] = value
    }
  } catch {
    // optional
  }
  return out
}

function inferAgentLlmUrl(env: Record<string, string>): void {
  if ((env.HERMES_AGENT_LLM_URL || '').trim()) return
  const base = (env.LLM_BASE_URL || '').trim().replace(/\/$/, '')
  const key = (env.LLM_API_KEY || '').trim()
  if (!base || !key || key === 'mock') return
  if (/:(3456)(?:\/|$)/i.test(base) || /lm-bridge/i.test(base)) return
  env.HERMES_AGENT_LLM_URL = base
}

const rootEnv = loadRootEnv()
inferAgentLlmUrl(rootEnv)
const childEnv = { ...process.env, ...rootEnv, FORCE_COLOR: '1' }

// Bun --hot panics on Windows after long runs (integer overflow). Opt in with HERMES_HOT=1.
const serverArgs = [bunExe, ...(childEnv.HERMES_HOT === '1' ? ['--hot'] as const : []), 'src/index.ts']

const server = Bun.spawn(serverArgs, {
  cwd: `${root}/server`,
  stdout: 'inherit',
  stderr: 'inherit',
  env: childEnv,
})

const app = Bun.spawn([bunExe, 'run', 'dev'], {
  cwd: `${root}/app`,
  stdout: 'inherit',
  stderr: 'inherit',
  env: childEnv,
})

function shutdown() {
  server.kill()
  app.kill()
  process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

await Promise.race([server.exited, app.exited])
shutdown()
