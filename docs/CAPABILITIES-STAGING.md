# Capability Hub — staging rollout gates

**Author:** Dinesh Reddy Meka  
**Product:** Open Jarvis  
**Scope:** Staging readiness for the Capability Hub (routing, degraded telemetry, warm path, slash-sync) plus Phase 4 release gates (`delegate_to_agent` providers, Cowork MCP bridge, rollback).

## Staging environment

Set these in the staging `.env` (see also root `.env.example`):

| Variable | Staging value | Notes |
|----------|---------------|--------|
| `HERMES_AGENT_LLM_URL` | Tool-capable OpenAI-compatible base | Required for MCP/A2UI/Cowork tool calls |
| `HERMES_EMBEDDINGS_URL` | Optional dedicated embeddings base | Defaults to agent URL; never prefers chat-only bridge |
| `HERMES_ROUTING` | `capabilities` | Default hub mode; set `legacy` only for rollback |
| `HERMES_AGENT_LLM_TIMEOUT_MS` | `5000` (or staging SLA) | Probe timeout before recording agent failure |
| `LLM_BASE_URL` | May be bridge or provider | Chat-only `:3456` / lm-bridge is fallback only when agent is unhealthy/unset |
| `HERMES_LM_BRIDGE` | `0` in staging | Dev-only auto-start of text chat bridge |

## Verification gates

### 1. Healthy hub

```bash
curl -s http://127.0.0.1:3001/api/capabilities | jq '{routing, retrievalMode, tools:(.tools|length), slashCommands:(.slashCommands|length), agentLlm}'
curl -s http://127.0.0.1:3001/api/debug/health | jq '{status, agentLlm, capabilities}'
```

Expect: `routing=capabilities`, `agentLlm.degraded=false`, `agentLlm.toolsEnabled=true`, non-null `preferredAgentBaseUrl`.

### 2. Degraded fallback

Simulate agent outage (wrong `HERMES_AGENT_LLM_URL`, kill provider, or unset agent URL while `LLM_BASE_URL` is the chat-only bridge), then:

```bash
curl -s 'http://127.0.0.1:3001/api/capabilities?probe=1' | jq '.agentLlm'
```

Expect: `degraded=true`, `toolsEnabled=false`, `lastFailure` or missing preferred URL. Connections panel shows **Agent tools unavailable**. AG-UI emits `hermes.capabilities.degraded` on runs.

### 3. Warm path

```bash
curl -s -X POST http://127.0.0.1:3001/api/capabilities/warm | jq '{ok, tools, skills, plugins, slashCommands, mcpReconnect, agentLlm}'
```

Expect: `ok=true`, `mcpReconnect.ok` true when MCP reconnects (false + `error` if reconnect fails but manifest still rebuilds), `agentLlm` present after probe, `slashCommands` count for composer sync.

UI: Connections → **Warm MCP + probe**.

### 4. Slash-sync readiness

1. `GET /api/capabilities` includes `slashCommands[]` (from MCP prompt metas).
2. App `CapabilitiesBootstrap` calls `syncCapabilitySlashCommands`.
3. Composer `/` autocomplete and Command Palette list synced commands.

Unit proof: `bun test app/test/capabilities-staging.test.ts app/test/composer-phase4.test.ts`

## Rollback

**Trigger:** capability routing regressions (wrong tools offered, runaway tool loops, slash-sync breakage) that are not fixed by `POST /api/capabilities` refresh / warm.

**Steps:**

1. Set `HERMES_ROUTING=legacy` in staging `.env`.
2. Restart the API process (env is read at boot).
3. Confirm:
   - `GET /api/debug/health` → `agentLlm.routing=legacy` and `capabilities.routing=legacy`
   - `GET /api/capabilities` → `routing=legacy`, `retrievalMode=legacy`
4. Expect legacy regex tool subsetting (`selectLlmToolsLegacy`) instead of hub retrieval.
5. To restore hub mode: set `HERMES_ROUTING=capabilities`, restart, re-run healthy/warm gates above.

**Owner response:** on-call staging operator; keep change in `.env` only (no code revert required for routing rollback).

## Phase 4 release checklist

| Gate | Expect | Notes |
|------|--------|--------|
| Focused unit tests | All pass | capabilities-health/rest/retrieve, delegate-to-agent, cowork-mcp-bridge/rest, app capabilities-staging + composer-phase4 |
| Tool-capable path | `agentLlm.degraded=false`, `toolsEnabled=true` | Requires `HERMES_AGENT_LLM_URL` (not chat-only `:3456`) |
| Degraded fallback | `degraded=true`, AG-UI `hermes.capabilities.degraded` | Proven when agent URL unset / bridge-only |
| `delegate_to_agent` | Unsupported/unavailable providers rejected; nested parent-child runs recorded | Unit + provider manifest `providers[]` |
| Cowork MCP bridge | progress + question handlers; `COWORK_PROGRESS` / `COWORK_QUESTION` extraction | Register via `POST /api/cowork/mcp-bridge/register` when Cowork closed |
| Warm path | `POST /api/capabilities/warm` returns ≤ ~15–20s with `mcpReconnect` | Bound by `HERMES_CAPABILITIES_WARM_MCP_MS` |
| Rollback | `HERMES_ROUTING=legacy` → health/capabilities show `legacy` | Restart required |

## Focused tests

```bash
bun test server/test/capabilities-health.test.ts server/test/capabilities-rest.test.ts server/test/capabilities-retrieve.test.ts server/test/delegate-to-agent.test.ts server/test/cowork-mcp-bridge.test.ts server/test/cowork-rest.test.ts
bun test app/test/capabilities-staging.test.ts app/test/composer-phase4.test.ts
```

Warm path (`POST /api/capabilities/warm`) is bounded by `HERMES_CAPABILITIES_WARM_MCP_MS` (default 15000). Prefer the curl gate above for live MCP reconnect proof.