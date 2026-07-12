const started = Date.now()
const ac = new AbortController()
const t = setTimeout(() => ac.abort(), 25_000)
try {
  const res = await fetch("http://127.0.0.1:3001/api/capabilities/warm", { method: "POST", signal: ac.signal })
  const body = await res.json()
  console.log(JSON.stringify({ ok: true, ms: Date.now()-started, status: res.status, mcpReconnect: body.mcpReconnect, tools: body.tools, agentDegraded: body.agentLlm?.degraded }, null, 2))
} catch (e) {
  console.log(JSON.stringify({ ok: false, ms: Date.now()-started, error: e instanceof Error ? e.message : String(e) }))
} finally {
  clearTimeout(t)
}
