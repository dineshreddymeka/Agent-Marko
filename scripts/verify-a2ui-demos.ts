/**
 * A2UI demo scenarios (Phase 5 AC) using mock LLM multi-turn scripts.
 */
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { resolveBunExecutable } from './lib/bun-path'

const root = import.meta.dir.replace(/[/\\]scripts$/, '')
const bun = resolveBunExecutable()

const SCENARIOS = ['a2ui-cron', 'a2ui-memory', 'a2ui-skills'] as const

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

function parseSseEvents(body: string): Array<{ type?: string; name?: string }> {
  const events: Array<{ type?: string; name?: string }> = []
  for (const block of body.split('\n\n')) {
    const line = block.split('\n').find((l) => l.startsWith('data: '))
    if (!line) continue
    try {
      events.push(JSON.parse(line.slice(6)) as { type?: string; name?: string })
    } catch {
      /* skip */
    }
  }
  return events
}

async function runScenario(
  port: number,
  scenario: (typeof SCENARIOS)[number],
): Promise<void> {
  const url = `http://127.0.0.1:${port}/agui`
  const input = {
    threadId: randomUUID(),
    runId: randomUUID(),
    messages: [{ id: randomUUID(), role: 'user', content: `Run ${scenario} demo` }],
    tools: [],
    state: {},
    context: [],
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!res.ok) throw new Error(`${scenario}: POST /agui failed (${res.status})`)

  const body = await res.text()
  const events = parseSseEvents(body)
  const types = events.map((e) => e.type)
  const a2ui = events.some((e) => e.type === 'CUSTOM' && e.name === 'a2ui.message')

  if (!types.includes('TOOL_CALL_START')) {
    throw new Error(`${scenario}: missing TOOL_CALL_START`)
  }
  if (!a2ui) {
    throw new Error(`${scenario}: missing a2ui.message custom event`)
  }
  if (!types.includes('RUN_FINISHED')) {
    throw new Error(`${scenario}: missing RUN_FINISHED`)
  }

  console.log(`  ✓ ${scenario}`)
}

async function main() {
  await loadEnv()

  const port = Number(process.env.HERMES_VERIFY_PORT ?? 3098)
  const serverProc = Bun.spawn([bun, 'src/index.ts'], {
    cwd: join(root, 'server'),
    stdout: 'pipe',
    stderr: 'inherit',
    env: {
      ...process.env,
      HERMES_MOCK_LLM: '1',
      AUTO_APPROVE_ALL: 'true',
      ALLOW_SIGNUP: 'false',
      HOST: '127.0.0.1',
      PORT: String(port),
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
    for (const scenario of SCENARIOS) {
      await runScenario(port, scenario)
    }
    console.log('A2UI demo verify: complete (3/3 scenarios)')
  } finally {
    serverProc.kill()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
