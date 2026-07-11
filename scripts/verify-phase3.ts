/**
 * Phase 3 acceptance (no real LLM key required):
 *   mock LLM unit tests → runtime golden stream → optional live POST /agui SSE smoke
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { resolveBunExecutable } from './lib/bun-path'

const root = import.meta.dir.replace(/[/\\]scripts$/, '')
const bun = resolveBunExecutable()

async function run(cmd: string[], opts?: { cwd?: string; env?: Record<string, string> }): Promise<number> {
  const proc = Bun.spawn(cmd, {
    cwd: opts?.cwd ?? root,
    stdout: 'inherit',
    stderr: 'inherit',
    env: { ...process.env, ...opts?.env },
  })
  return proc.exited
}

async function loadEnv(): Promise<void> {
  const envPath = join(root, '.env')
  if (!existsSync(envPath)) return
  const text = await Bun.file(envPath).text()
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const idx = trimmed.indexOf('=')
    if (idx === -1) continue
    const key = trimmed.slice(0, idx)
    const value = trimmed.slice(idx + 1)
    if (!process.env[key]) process.env[key] = value
  }
}

function parseSseEvents(body: string): string[] {
  const types: string[] = []
  for (const block of body.split('\n\n')) {
    const line = block.split('\n').find((l) => l.startsWith('data: '))
    if (!line) continue
    try {
      const json = JSON.parse(line.slice(6)) as { type?: string }
      if (json.type) types.push(json.type)
    } catch {
      /* skip */
    }
  }
  return types
}

async function aguiSmoke(port: number): Promise<void> {
  const url = `http://127.0.0.1:${port}/agui`
  const input = {
    threadId: randomUUID(),
    runId: randomUUID(),
    messages: [{ id: randomUUID(), role: 'user', content: 'ping' }],
    tools: [],
    state: {},
    context: [],
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!res.ok) {
    throw new Error(`POST /agui failed: ${res.status}`)
  }

  const body = await res.text()
  const types = parseSseEvents(body)
  const required = ['RUN_STARTED', 'TEXT_MESSAGE_START', 'TEXT_MESSAGE_CONTENT', 'RUN_FINISHED']
  for (const t of required) {
    if (!types.includes(t)) {
      throw new Error(`Missing AG-UI event ${t}. Got: ${types.join(', ')}`)
    }
  }
  console.log('AG-UI SSE smoke OK')
}

async function main() {
  await loadEnv()

  console.log('Step 1/3: mock LLM + runtime tests')
  const testCode = await run(
    [bun, 'test', 'server/test/mock-llm.test.ts', 'server/test/runtime-mock.test.ts', 'server/test/cancel-run.test.ts'],
    { env: { HERMES_MOCK_LLM: '1', AUTO_APPROVE_ALL: 'true' } },
  )
  if (testCode !== 0) process.exit(1)

  console.log('Step 2/3: full server test suite')
  if ((await run([bun, 'test', 'server'])) !== 0) process.exit(1)

  console.log('Step 3/3: live POST /agui with HERMES_MOCK_LLM=1')
  const port = Number(process.env.HERMES_VERIFY_PORT ?? 3099)
  const serverProc = Bun.spawn([bun, 'src/index.ts'], {
    cwd: join(root, 'server'),
    stdout: 'pipe',
    stderr: 'inherit',
    env: {
      ...process.env,
      HERMES_MOCK_LLM: '1',
      AUTO_APPROVE_ALL: 'true',
      PORT: String(port),
      HOST: '127.0.0.1',
    },
  })

  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    try {
      const health = await fetch(`http://127.0.0.1:${port}/api/health`)
      if (health.ok) break
    } catch {
      await Bun.sleep(300)
    }
  }

  try {
    await aguiSmoke(port)
  } finally {
    serverProc.kill()
  }

  console.log('Phase 3 verify: complete')
  console.log('Optional: set LLM_API_KEY and re-run without HERMES_MOCK_LLM for a real provider smoke.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
