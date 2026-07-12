/** Phase 4 live smoke against :3001 — degraded / warm / AG-UI / cowork setup. */
const results: Array<{ name: string; ok: boolean; detail: string; soft?: boolean }> = []

function rec(name: string, ok: boolean, detail: string, soft = false) {
  results.push({ name, ok, detail, soft })
  console.log(`${ok ? 'PASS' : soft ? 'SKIP' : 'FAIL'}  ${name} — ${detail}`)
}

const BASE = 'http://127.0.0.1:3001'

{
  const res = await fetch(`${BASE}/api/capabilities?probe=1`)
  const body = (await res.json()) as any
  const degraded = body.agentLlm?.degraded === true
  const toolsOff = body.agentLlm?.toolsEnabled === false
  const routing = body.agentLlm?.routing ?? body.routing
  rec(
    'degraded fallback telemetry',
    res.ok && degraded && toolsOff && routing === 'capabilities',
    `status=${res.status} routing=${routing} degraded=${body.agentLlm?.degraded} toolsEnabled=${body.agentLlm?.toolsEnabled} preferred=${body.agentLlm?.preferredAgentBaseUrl ?? 'null'} bridge=${body.agentLlm?.bridgeFallbackBaseUrl ?? 'n/a'} providers=${(body.providers || []).length} tools=${(body.tools || []).length}`,
  )
  const toolCapable =
    body.agentLlm?.degraded === false &&
    body.agentLlm?.toolsEnabled === true &&
    !!body.agentLlm?.preferredAgentBaseUrl
  rec(
    'tool-capable path (env)',
    toolCapable,
    toolCapable
      ? `preferred=${body.agentLlm.preferredAgentBaseUrl}`
      : 'ENV LIMITATION: HERMES_AGENT_LLM_URL unset; LLM_BASE_URL is chat-only bridge (:3456). Cannot prove toolsEnabled=true until a tool-capable agent URL is configured.',
    true,
  )
}

{
  const res = await fetch(`${BASE}/api/capabilities`, { method: 'POST' })
  const body = (await res.json()) as any
  rec(
    'POST /api/capabilities refresh',
    res.ok && body.ok === true && typeof body.tools === 'number',
    `status=${res.status} ok=${body.ok} tools=${body.tools} providers=${body.providers} slash=${body.slashCommands} agentDegraded=${body.agentLlm?.degraded}`,
  )
}

{
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), 45_000)
  try {
    const started = Date.now()
    const res = await fetch(`${BASE}/api/capabilities/warm`, { method: 'POST', signal: ac.signal })
    const body = (await res.json()) as any
    rec(
      'POST /api/capabilities/warm',
      res.ok && body.ok === true && body.mcpReconnect && typeof body.mcpReconnect.ok === 'boolean',
      `status=${res.status} ok=${body.ok} ms=${Date.now() - started} mcpReconnect=${JSON.stringify(body.mcpReconnect)} tools=${body.tools} agentDegraded=${body.agentLlm?.degraded}`,
    )
  } catch (err) {
    rec('POST /api/capabilities/warm', false, `error=${err instanceof Error ? err.message : String(err)}`)
  } finally {
    clearTimeout(t)
  }
}

{
  const runId = crypto.randomUUID()
  const threadId = crypto.randomUUID()
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), 90_000)
  try {
    const res = await fetch(`${BASE}/agui`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: ac.signal,
      body: JSON.stringify({
        threadId,
        runId,
        messages: [{ id: crypto.randomUUID(), role: 'user', content: 'Reply with exactly: pong' }],
        tools: [],
        context: [],
        state: {},
        forwardedProps: {},
      }),
    })
    if (!res.ok || !res.body) {
      rec('AG-UI degraded custom event', false, `status=${res.status} body=${(await res.text()).slice(0, 200)}`)
      rec('AG-UI degraded run completes', false, 'no stream')
    } else {
      const reader = res.body.getReader()
      const dec = new TextDecoder()
      let buf = ''
      let sawDegraded = false
      let sawFinished = false
      let sawError = false
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        if (buf.includes('hermes.capabilities.degraded')) sawDegraded = true
        if (buf.includes('RUN_FINISHED')) sawFinished = true
        if (buf.includes('RUN_ERROR')) sawError = true
        if (sawDegraded && (sawFinished || buf.length > 80_000)) break
      }
      rec(
        'AG-UI degraded custom event',
        sawDegraded,
        `sawDegraded=${sawDegraded} sawFinished=${sawFinished} sawError=${sawError} bytes=${buf.length}`,
      )
      rec(
        'AG-UI degraded run completes',
        sawFinished,
        `sawFinished=${sawFinished} sawError=${sawError} snippet=${buf.slice(0, 180).replace(/\n/g, ' ')}`,
      )
    }
  } catch (err) {
    rec('AG-UI degraded run', false, `error=${err instanceof Error ? err.message : String(err)}`)
  } finally {
    clearTimeout(t)
  }
}

{
  const res = await fetch(`${BASE}/api/cowork/setup`)
  const body = (await res.json()) as any
  rec(
    'cowork setup readiness',
    res.ok && typeof body.configured === 'boolean' && !!body.mcpBridge,
    `configured=${body.configured} headless=${body.headlessSupported} mcpBridge.readiness=${body.mcpBridge?.readiness} registered=${body.mcpBridge?.registered}`,
  )
}

console.log('\n=== SUMMARY ===')
for (const r of results) {
  console.log(`${r.ok ? 'PASS' : r.soft ? 'SKIP' : 'FAIL'}\t${r.name}`)
}
const hardFails = results.filter((r) => !r.ok && !r.soft)
console.log(`hard_fails=${hardFails.length}`)
process.exit(hardFails.length ? 1 : 0)
