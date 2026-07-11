/**
 * Real LLM smoke test — skipped when LLM_API_KEY is unset.
 */
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { resolveBunExecutable } from './lib/bun-path'

const root = import.meta.dir.replace(/[/\\]scripts$/, '')
const bun = resolveBunExecutable()

async function loadEnv(): Promise<void> {
  const envPath = join(root, '.env')
  try {
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
  } catch {
    /* no .env */
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

async function main() {
  await loadEnv()

  const key = process.env.LLM_API_KEY?.trim()
  if (!key || key === 'mock') {
    console.log('Phase 3 LLM verify: skipped (set LLM_API_KEY in .env)')
    return
  }

  if (process.env.HERMES_MOCK_LLM === '1') {
    console.warn('HERMES_MOCK_LLM=1 is set — unset it for a real provider smoke.')
  }

  const port = Number(process.env.HERMES_VERIFY_PORT ?? 3097)
  const serverProc = Bun.spawn([bun, 'src/index.ts'], {
    cwd: join(root, 'server'),
    stdout: 'pipe',
    stderr: 'inherit',
    env: {
      ...process.env,
      HERMES_MOCK_LLM: '0',
      PORT: String(port),
      HOST: '127.0.0.1',
    },
  })

  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) break
    } catch {
      await Bun.sleep(400)
    }
  }

  try {
    const input = {
      threadId: randomUUID(),
      runId: randomUUID(),
      messages: [{ id: randomUUID(), role: 'user', content: 'Reply with exactly: pong' }],
      tools: [],
      state: {},
      context: [],
    }

    const res = await fetch(`http://127.0.0.1:${port}/agui`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(120_000),
    })

    if (!res.ok) {
      throw new Error(`POST /agui failed: ${res.status} ${await res.text()}`)
    }

    const types = parseSseEvents(await res.text())
    if (!types.includes('TEXT_MESSAGE_CONTENT')) {
      throw new Error(`No streamed content. Events: ${types.join(', ')}`)
    }
    if (!types.includes('RUN_FINISHED') && !types.includes('RUN_ERROR')) {
      throw new Error(`Run did not finish. Events: ${types.join(', ')}`)
    }
    if (types.includes('RUN_ERROR')) {
      throw new Error('Run ended with RUN_ERROR — check LLM_BASE_URL and API key')
    }

    console.log('Phase 3 LLM verify: complete (real provider responded)')
  } finally {
    serverProc.kill()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
