# Open Jarvis — logging guide

**Author:** Dinesh Reddy Meka  
**Product:** Open Jarvis

Maximize debuggability with structured, correlated logs. Secrets (`api_key`, `authorization`, `token`, …) are always redacted.

## Quick local setup

In `.env`:

```env
LOG_LEVEL=debug
LOG_PRETTY=1
LOG_HTTP=1
DEBUG_LLM=1
DEBUG_AGUI=1
DEBUG_DB=1
DEBUG_MCP=1
DEBUG_TOOLS=1
```

Restart `bun run dev`. Every HTTP call gets an `X-Request-Id` (also echoed on 500 JSON as `requestId`).

## Flags

| Flag | Effect |
|------|--------|
| `LOG_LEVEL=debug` | Enables debug channel defaults |
| `LOG_PRETTY=1` | Human-readable lines (default when level=debug) |
| `LOG_JSON=1` | Force JSON lines |
| `LOG_HTTP` / `DEBUG_HTTP` | Request + response timing |
| `DEBUG_LLM` | LLM start/end, model, counts |
| `DEBUG_LLM_FULL` | Include message/tool payloads (still redacted keys) |
| `DEBUG_AGUI` | Per-event AG-UI stream trace + run summaries |
| `DEBUG_DB` | DB unreachability / metrics |
| `DEBUG_MCP` | MCP connect attempts |
| `DEBUG_TOOLS` | Tool invoke start/end + duration |

## Correlation fields

Look for: `req=` / `requestId`, `thread=` / `threadId`, `run=` / `runId`, `tool=` / `toolCallId`, `durationMs`, `stack` on errors.
