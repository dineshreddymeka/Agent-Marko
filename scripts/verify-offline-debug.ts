/** Verify debug replay works without Postgres (in-memory run buffer). */
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { resolveBunExecutable } from './lib/bun-path'

const root = import.meta.dir.replace(/[/\\]scripts$/, '')
const bun = resolveBunExecutable()

async function main() {
  const port = Number(process.env.HERMES_VERIFY_PORT ?? 3096)
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
      // Force offline path even when local Postgres is running
      DATABASE_URL: `postgres://offline:offline@127.0.0.1:1/offline_${port}`,
    },
  })

  try {
    const deadline = Date.now() + 20_000
    while (Date.now() < deadline) {
      try {
        if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) break
      } catch {
        await Bun.sleep(300)
      }
    }

    const runId = randomUUID()
    const threadId = randomUUID()
    const aguiRes = await fetch(`http://127.0.0.1:${port}/agui`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        threadId,
        runId,
        messages: [{ id: randomUUID(), role: 'user', content: 'ping' }],
        tools: [],
        state: {},
        context: [],
      }),
    })
    if (!aguiRes.ok) throw new Error(`POST /agui failed: ${aguiRes.status}`)
    await aguiRes.text()

    const runsRes = await fetch(`http://127.0.0.1:${port}/api/debug/runs`)
    const runsBody = (await runsRes.json()) as { runs?: unknown[]; source?: string }
    if (!runsRes.ok || runsBody.source !== 'memory') {
      throw new Error('Expected in-memory debug runs list')
    }
    if (!runsBody.runs?.length) {
      throw new Error('No buffered runs returned')
    }

    const eventsRes = await fetch(`http://127.0.0.1:${port}/api/debug/runs/${runId}/events`)
    const eventsBody = (await eventsRes.json()) as { events?: unknown[]; source?: string }
    if (!eventsRes.ok || eventsBody.source !== 'memory' || !eventsBody.events?.length) {
      throw new Error('Expected buffered run events')
    }

    console.log('Offline debug verify: complete')
  } finally {
    serverProc.kill()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
