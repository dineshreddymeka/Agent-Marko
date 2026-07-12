/** Prove warm endpoint returns within bound on current code (ephemeral port). */
import { join } from 'node:path'
import { resolveBunExecutable } from '../scripts/lib/bun-path.ts'

const root = join(import.meta.dir, '..')
const bun = resolveBunExecutable()
const port = 3099

const proc = Bun.spawn([bun, 'src/index.ts'], {
  cwd: join(root, 'server'),
  stdout: 'pipe',
  stderr: 'pipe',
  env: {
    ...process.env,
    HOST: '127.0.0.1',
    PORT: String(port),
    HERMES_ROUTING: 'capabilities',
    HERMES_MOCK_LLM: '1',
    HERMES_CAPABILITIES_WARM_MCP_MS: '3000',
    AUTO_APPROVE_ALL: 'true',
    ALLOW_SIGNUP: 'false',
  },
})

async function waitHealth(timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  let last = ''
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`)
      if (res.ok) return await res.json()
      last = await res.text()
    } catch (e) {
      last = String(e)
    }
    await Bun.sleep(300)
  }
  throw new Error(`health timeout: ${last}`)
}

try {
  await waitHealth()
  const started = Date.now()
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), 20_000)
  const res = await fetch(`http://127.0.0.1:${port}/api/capabilities/warm`, {
    method: 'POST',
    signal: ac.signal,
  })
  clearTimeout(t)
  const body = (await res.json()) as any
  const ms = Date.now() - started
  const ok =
    res.ok &&
    body.ok === true &&
    typeof body.mcpReconnect?.ok === 'boolean' &&
    ms < 18_000
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  warm on fresh server — status=${res.status} ms=${ms} mcpReconnect=${JSON.stringify(body.mcpReconnect)} tools=${body.tools} agentDegraded=${body.agentLlm?.degraded}`,
  )
  process.exit(ok ? 0 : 1)
} catch (err) {
  console.log(`FAIL  warm on fresh server — ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
} finally {
  proc.kill()
  try {
    await proc.exited
  } catch {
    /* ignore */
  }
}
