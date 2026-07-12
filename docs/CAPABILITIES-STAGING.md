# Capability Hub — staging rollout gates

**Author:** Dinesh Reddy Meka  
**Product:** Open Jarvis  
**Scope:** Staging readiness for the Capability Hub (routing, degraded telemetry, warm path, slash-sync). Phase 4 provider/Cowork contract work is out of scope here.

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

Set `HERMES_ROUTING=legacy` and restart the API. Debug health `capabilities.routing` / `agentLlm.routing` should read `legacy`. Full rollback checklist is a later release gate.

## Focused tests

```bash
bun test server/test/capabilities-health.test.ts server/test/capabilities-rest.test.ts server/test/capabilities-retrieve.test.ts
bun test app/test/capabilities-staging.test.ts app/test/composer-phase4.test.ts
```
