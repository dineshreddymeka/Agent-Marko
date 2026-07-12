/**
 * End-to-end live feature smoke against a running Open Jarvis API.
 *
 * Usage:
 *   bun run scripts/verify-live-features.ts
 *   BASE_URL=http://127.0.0.1:3001 bun run scripts/verify-live-features.ts
 */
const BASE = (process.env.BASE_URL ?? 'http://127.0.0.1:3001').replace(/\/$/, '')

type Check = { name: string; ok: boolean; detail?: string }

const checks: Check[] = []

function record(name: string, ok: boolean, detail?: string) {
  checks.push({ name, ok, detail })
  const mark = ok ? 'PASS' : 'FAIL'
  console.log(`${mark}  ${name}${detail ? ` — ${detail}` : ''}`)
}

async function getJson(path: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${BASE}${path}`, { signal: AbortSignal.timeout(20_000) })
  const text = await res.text()
  let body: unknown = text
  try {
    body = JSON.parse(text)
  } catch {
    /* keep text */
  }
  return { status: res.status, body }
}

async function postJson(path: string, payload: unknown): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30_000),
  })
  const text = await res.text()
  let body: unknown = text
  try {
    body = JSON.parse(text)
  } catch {
    /* keep text */
  }
  return { status: res.status, body }
}

async function main() {
  console.log(`Live feature smoke → ${BASE}\n`)

  // 1) Health
  {
    const { status, body } = await getJson('/api/health')
    const b = body as { ok?: boolean; db?: boolean; llm?: { mock?: boolean } }
    record('GET /api/health', status === 200 && b.ok === true && b.db === true, JSON.stringify(b))
  }

  // 2) OpenAPI + docs
  {
    const { status, body } = await getJson('/api/openapi.json')
    const b = body as { openapi?: string; paths?: Record<string, unknown> }
    record(
      'GET /api/openapi.json',
      status === 200 && typeof b.openapi === 'string' && Boolean(b.paths),
      `openapi=${b.openapi} paths=${Object.keys(b.paths ?? {}).length}`,
    )
  }
  {
    const res = await fetch(`${BASE}/api/docs`, { signal: AbortSignal.timeout(15_000) })
    record('GET /api/docs', res.status === 200, `status=${res.status}`)
  }

  // 3) System cron catalog (DB Consistency / Bug Bounty / Status Auto-Approve)
  {
    const { status, body } = await getJson('/api/cron/system')
    const b = body as {
      catalog?: Array<{ kind?: string }>
      jobs?: Array<{ name?: string; enabled?: boolean }>
    }
    const kinds = new Set((b.catalog ?? []).map((c) => c.kind))
    const ok =
      status === 200 &&
      kinds.has('db-consistency') &&
      kinds.has('bug-bounty') &&
      kinds.has('status-auto-approve') &&
      (b.jobs?.length ?? 0) >= 3
    record(
      'GET /api/cron/system',
      ok,
      `kinds=[${[...kinds].join(',')}] jobs=${b.jobs?.length ?? 0}`,
    )
  }

  // 4) Approval lock
  {
    const { status, body } = await getJson('/api/approval/config')
    const b = body as { autoApproveAll?: boolean }
    record(
      'GET /api/approval/config (locked on)',
      status === 200 && b.autoApproveAll === true,
      JSON.stringify(b),
    )
  }

  // 5) Cowork setup endpoint
  {
    const { status, body } = await getJson('/api/cowork/setup')
    record('GET /api/cowork/setup', status === 200, JSON.stringify(body).slice(0, 200))
  }

  // 6) Sessions list
  {
    const { status, body } = await getJson('/api/sessions')
    record('GET /api/sessions', status === 200, JSON.stringify(body).slice(0, 160))
  }

  // 7) Settings
  {
    const { status } = await getJson('/api/settings')
    record('GET /api/settings', status === 200, `status=${status}`)
  }

  // 8) MCP servers list
  {
    const { status, body } = await getJson('/api/mcp')
    record('GET /api/mcp', status === 200, JSON.stringify(body).slice(0, 160))
  }

  // 9) Create session + AG-UI mock run (chat path)
  {
    const created = await postJson('/api/sessions', { title: 'Live net smoke' })
    const session = created.body as { id?: string; session?: { id?: string } }
    const sessionId = session.id ?? session.session?.id
    if (!sessionId) {
      record('POST /api/sessions', false, JSON.stringify(created.body).slice(0, 200))
    } else {
      record('POST /api/sessions', created.status === 200 || created.status === 201, sessionId)

      const runId = `live-smoke-${Date.now()}`
      const res = await fetch(`${BASE}/agui`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify({
          threadId: sessionId,
          runId,
          messages: [
            {
              id: 'm1',
              role: 'user',
              content: 'Fetch https://example.com and summarize the page title.',
            },
          ],
          tools: [],
          context: [],
          forwardedProps: {},
        }),
        signal: AbortSignal.timeout(30_000),
      })
      const sse = await res.text()
      const ok =
        res.status === 200 &&
        sse.includes('RUN_STARTED') &&
        sse.includes('RUN_FINISHED') &&
        !sse.includes('RUN_ERROR')
      record('POST /agui (mock LLM SSE)', ok, `status=${res.status} bytes=${sse.length}`)

      const msgs = await getJson(`/api/sessions/${sessionId}/messages`)
      record(
        'GET /api/sessions/{id}/messages',
        msgs.status === 200,
        `status=${msgs.status} ${JSON.stringify(msgs.body).slice(0, 120)}`,
      )
    }
  }

  // 10) Direct live tool exercise via debug if available, else skip
  {
    const { status, body } = await getJson('/api/debug/health')
    record(
      'GET /api/debug/health',
      status === 200 || status === 404,
      `status=${status} ${JSON.stringify(body).slice(0, 120)}`,
    )
  }

  // 11) Indexer status
  {
    const { status, body } = await getJson('/api/indexer/status')
    record(
      'GET /api/indexer/status',
      status === 200 || status === 404,
      `status=${status} ${JSON.stringify(body).slice(0, 120)}`,
    )
  }

  // 12) Live outbound fetch from this script (proves egress)
  {
    const res = await fetch('https://example.com', { signal: AbortSignal.timeout(15_000) })
    const text = await res.text()
    record(
      'egress example.com',
      res.status === 200 && text.toLowerCase().includes('example domain'),
      `status=${res.status} bytes=${text.length}`,
    )
  }
  {
    const res = await fetch('https://api.duckduckgo.com/?q=Open+Source&format=json&no_html=1', {
      signal: AbortSignal.timeout(15_000),
    })
    const json = (await res.json()) as { Heading?: string; AbstractText?: string; RelatedTopics?: unknown[] }
    const ok =
      res.status === 200 &&
      (Boolean(json.AbstractText) || (json.RelatedTopics?.length ?? 0) > 0 || Boolean(json.Heading))
    record('egress DuckDuckGo Instant Answer', ok, `heading=${json.Heading ?? ''}`)
  }
  {
    const res = await fetch('https://jsonplaceholder.typicode.com/posts/1', {
      signal: AbortSignal.timeout(15_000),
    })
    const json = (await res.json()) as { id?: number; title?: string }
    record('egress JSONPlaceholder', res.status === 200 && json.id === 1, json.title?.slice(0, 60))
  }

  const failed = checks.filter((c) => !c.ok)
  console.log(`\n${checks.length - failed.length}/${checks.length} passed`)
  if (failed.length) {
    console.error('Failed:', failed.map((f) => f.name).join(', '))
    process.exit(1)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
