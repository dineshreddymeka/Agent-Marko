/** Verify debug replay works without Postgres (in-memory run buffer). */
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { resolveBunExecutable } from './lib/bun-path'

const root = import.meta.dir.replace(/[/\\]scripts$/, '')
const bun = resolveBunExecutable()

async function waitForHealth(port: number, timeoutMs = 20_000): Promise<{ ok: boolean; db?: boolean }> {
  const deadline = Date.now() + timeoutMs
  let lastErr: unknown
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`)
      if (res.ok) {
        const body = (await res.json()) as { ok?: boolean; db?: boolean }
        if (body.ok) return { ok: true, db: body.db }
      }
    } catch (err) {
      lastErr = err
    }
    await Bun.sleep(300)
  }
  throw new Error(`Health check timed out on :${port}${lastErr ? ` (${String(lastErr)})` : ''}`)
}

async function main() {
  const port = Number(process.env.HERMES_VERIFY_PORT ?? 3096)
  const serverProc = Bun.spawn([bun, 'src/index.ts'], {
    cwd: join(root, 'server'),
    stdout: 'pipe',
    stderr: 'pipe',
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
    const health = await waitForHealth(port)
    if (health.db === true) {
      throw new Error('Expected offline health with db !== true (unreachable DATABASE_URL)')
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
    const sseBody = await aguiRes.text()
    if (!sseBody.includes('RUN_STARTED') || !sseBody.includes('RUN_FINISHED')) {
      throw new Error('AG-UI stream missing RUN_STARTED / RUN_FINISHED')
    }

    const runsRes = await fetch(`http://127.0.0.1:${port}/api/debug/runs`)
    const runsBody = (await runsRes.json()) as {
      runs?: Array<{ runId?: string }>
      source?: string
    }
    if (!runsRes.ok || runsBody.source !== 'memory') {
      throw new Error(`Expected in-memory debug runs list, got source=${runsBody.source}`)
    }
    if (!runsBody.runs?.length) {
      throw new Error('No buffered runs returned')
    }
    if (!runsBody.runs.some((r) => r.runId === runId)) {
      throw new Error(`Buffered runs missing runId ${runId}`)
    }

    const eventsRes = await fetch(`http://127.0.0.1:${port}/api/debug/runs/${runId}/events`)
    const eventsBody = (await eventsRes.json()) as { events?: unknown[]; source?: string }
    if (!eventsRes.ok || eventsBody.source !== 'memory' || !eventsBody.events?.length) {
      throw new Error('Expected buffered run events')
    }

    console.log('Offline debug verify: complete')
  } finally {
    serverProc.kill()
    // Give the port a moment to release (avoids flaky re-runs on the same port)
    await Bun.sleep(200)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
