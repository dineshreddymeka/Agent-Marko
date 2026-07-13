# Top 20 AG-UI / A2UI Internet Issues

Curated from AG-UI protocol docs, GitHub issues, CopilotKit integrations, Google A2UI spec, and common fleet integration pitfalls. Use when users **explicitly** ask for AGUI/A2UI troubleshooting.

---

## 1. Chat UI blank after agent responds (thinking event mismatch)

- **Symptom**: Server run completes but browser chat stays empty; console shows `Cannot send 'THINKING_TEXT_MESSAGE_START' event: A thinking step is not in progress`.
- **Likely cause**: Mismatched `@ag-ui/core` (server) vs `@ag-ui/client` (frontend) event validation — server emits thinking deltas without a preceding `THINKING_START`.
- **Fix**: Align package versions across server and app; migrate to `REASONING_*` events per AG-UI 1.0; verify SSE with `curl -N POST /agui` before debugging UI.
- **Source**: https://github.com/pydantic/pydantic-ai/issues/2687

## 2. THINKING_* events removed in AG-UI 1.0

- **Symptom**: Client rejects or ignores thinking/reasoning streams after upgrading `@ag-ui/core` or `@ag-ui/client`.
- **Likely cause**: `THINKING_*` events are deprecated and removed in AG-UI 1.0; only `REASONING_*` lifecycle events are valid.
- **Fix**: Replace `THINKING_START` → `REASONING_START`, `THINKING_TEXT_MESSAGE_*` → `REASONING_MESSAGE_*`, `THINKING_END` → `REASONING_END` on both producer and consumer.
- **Source**: https://docs.ag-ui.com/concepts/reasoning

## 3. Duplicate @ag-ui/core copies (type/runtime mismatch)

- **Symptom**: TypeScript type errors, subtle runtime bugs, or CopilotKit `AbstractAgent` incompatibility with multiple AG-UI versions installed.
- **Likely cause**: `@ag-ui/core` bundled as a regular dependency in multiple packages instead of a single peer dependency instance.
- **Fix**: Dedupe with package manager overrides; upgrade to builds where `@ag-ui/core` is a peerDependency (PR #1196 / #1497).
- **Source**: https://github.com/ag-ui-protocol/ag-ui/issues/1176

## 4. Agent stalls after reasoning/thinking phase (CopilotKit)

- **Symptom**: SSE stream stops after reasoning content; no text, tool calls, or `RUN_END`.
- **Likely cause**: Provider never emits `reasoning-end`; CopilotKit state machine stays in reasoning phase. Empty reasoning deltas can also kill the RxJS pipeline (Zod rejects `delta: ""`).
- **Fix**: Upgrade CopilotKit agent packages (PR #3526); auto-close reasoning lifecycle on phase transitions; strip empty reasoning deltas.
- **Source**: https://github.com/CopilotKit/CopilotKit/issues/3323

## 5. Tool calls invisible in frontend (AG-UI FastAPI)

- **Symptom**: Agent uses tools server-side but UI only updates on final text reply; no `TOOL_CALL_*` SSE events.
- **Likely cause**: `emit_tool_calls` defaults to off in CopilotKit AG-UI FastAPI integration.
- **Fix**: `copilotkit_customize_config(config, emit_tool_calls=True)` (globally or per tool name).
- **Source**: https://github.com/CopilotKit/CopilotKit/issues/2411

## 6. HttpAgent fails with Google Gemini SSE

- **Symptom**: `Run ended without emitting a terminal event`; raw Gemini SSE does not match AG-UI/CopilotKit schema.
- **Likely cause**: Native Gemini streaming lacks `RUN_FINISHED` / `RUN_ERROR` terminal events and CopilotKit-specific framing.
- **Fix**: Use `GoogleGenerativeAIAdapter` or OpenAI-compatible Gemini endpoint; do not pipe raw provider SSE directly to `@ag-ui/client` HttpAgent.
- **Source**: https://github.com/CopilotKit/CopilotKit/issues/3085

## 7. Out-of-order nested text/tool events rejected

- **Symptom**: `CopilotKitError: Cannot send event type 'TEXT_MESSAGE_START' after 'TOOL_CALL_START'`.
- **Likely cause**: Strict serial `verifyEvents` in older `@ag-ui/client` / `@ag-ui/agno` despite AG-UI spec allowing resilient out-of-order delivery.
- **Fix**: Upgrade `@ag-ui/agno` to 0.0.3+ and CopilotKit to v1.53.0+; ensure client tolerates concurrent tool/text events.
- **Source**: https://github.com/CopilotKit/CopilotKit/issues/2684

## 8. Frontend tools unavailable with Google ADK 2.0

- **Symptom**: `Tool 'widgetRenderer' not found` or `AGUIToolset is a placeholder and should be replaced with ClientProxyToolset`.
- **Likely cause**: ADK 2.0 Runner caches tools before `AGUIToolset` is replaced with `ClientProxyToolset`.
- **Fix**: Use delegating `get_tools` monkey-patch workaround; prefer ADK 1.x until middleware officially supports ADK 2.0 alpha.
- **Source**: https://github.com/ag-ui-protocol/ag-ui/issues/1389

## 9. Pydantic ValidationError on `$schema` in tool parameters

- **Symptom**: ADK agent returns HTTP 200 with no output; logs show `Extra inputs are not permitted` for `$schema`.
- **Likely cause**: MCP/Zod tool schemas include JSON Schema meta-fields (`$schema`) that `google.genai.types.Schema` rejects.
- **Fix**: Strip keys starting with `$` before `model_validate` in `ClientProxyTool` (fixed in ag-ui PR #1354).
- **Source**: https://github.com/ag-ui-protocol/ag-ui/issues/1349

## 10. MCP Apps schema fields rejected by ADK middleware

- **Symptom**: Similar to #9 but also fails on `exclusiveMinimum` and other JSON Schema keywords from MCP Apps tools.
- **Likely cause**: Direct validation of MCP tool JSON Schema against Google GenAI Schema without normalization.
- **Fix**: Upgrade ag-ui-adk; strip unsupported schema keywords; use tools without draft-07 meta-fields where possible.
- **Source**: https://github.com/ag-ui-protocol/ag-ui/issues/1003

## 11. HITL turn crashes with DatabaseSessionService OCC

- **Symptom**: `RunErrorEvent` / `BACKGROUND_EXECUTION_ERROR`: session modified in storage since loaded.
- **Likely cause**: Middleware writes `pending_tool_calls` while ADK Runner still holds the same session (optimistic concurrency in ADK 1.27+).
- **Fix**: Upgrade ag-ui-adk middleware (CHANGELOG #1732–#1755 fixes); avoid concurrent session.state writes during active runs.
- **Source**: https://github.com/ag-ui-protocol/ag-ui/blob/main/integrations/adk-middleware/python/CHANGELOG.md

## 12. A2UI surface blank — updates before createSurface

- **Symptom**: Components never render; validator errors on `updateComponents` or `updateDataModel`.
- **Likely cause**: Agent sent component/data updates before `createSurface` for that `surfaceId`.
- **Fix**: Always emit `createSurface` first; only skip if client already owns the surface; follow JSONL message order in spec.
- **Source**: https://github.com/google/A2UI/blob/main/specification/v0_9/docs/a2ui_protocol.md

## 13. Duplicate surfaceId without deleteSurface

- **Symptom**: Second `createSurface` fails validation; stale UI or React StrictMode double-mount issues.
- **Likely cause**: `surfaceId` must be globally unique for the renderer session; reusing IDs without `deleteSurface` is an error.
- **Fix**: Use UUIDs or agent-prefixed IDs; call `deleteSurface` before recreate; make create logic idempotent in dev (StrictMode).
- **Source**: https://github.com/a2ui-project/a2ui/commit/9976ad000ef913c5e849da3036d1aa34903b14c8

## 14. A2UI VALIDATION_FAILED component schema errors

- **Symptom**: Client sends `error` with `code: VALIDATION_FAILED` and JSON pointer path (e.g. `/components/0/text`).
- **Likely cause**: Agent output used wrong types (integer vs stringOrPath) or unknown catalog component props.
- **Fix**: Return standard error to LLM for self-correction; validate against catalog JSON Schema; use A2UI SDK generate-validate-retry loop.
- **Source**: https://a2ui.org/guides/renderer-development/

## 15. A2UI v0.8 → v0.9 migration breaks renderers

- **Symptom**: Theme/colors missing; validation errors on `theme.primaryColor`; action handling changed.
- **Likely cause**: v0.9 renames `theme` → `surfaceProperties`, removes inline primaryColor, adds `checks` array and `sendDataModel`.
- **Fix**: Follow evolution guide; update renderer checklist; use prompt-native generation instead of inline schema in v0.9.
- **Source**: https://a2ui.org/specification/v0.9-evolution-guide

## 16. sendDataModel metadata not reaching server

- **Symptom**: Agent lacks UI state on user actions; repeats questions already answered in form fields.
- **Likely cause**: `createSurface.sendDataModel: true` set but client transport does not attach full data model to action metadata.
- **Fix**: Wire transport metadata per A2A/AG-UI extension; verify `a2uiClientCapabilities` in A2A messages.
- **Source**: https://github.com/google/A2UI/blob/main/specification/v0_9/docs/a2ui_protocol.md

## 17. CUSTOM a2ui.message not rendered in client

- **Symptom**: SSE shows tool result / custom event but no interactive surface in chat.
- **Likely cause**: Frontend dispatcher not subscribed, wrong event name, or payload missing `surfaceId` + `component`.
- **Fix**: Handle `HermesCustomEvents.A2UI_MESSAGE`; route through `processA2UIMessage`; persist `a2ui` ref on messages for hydration.
- **Source**: https://github.com/ag-ui-protocol/ag-ui (AG-UI CUSTOM events) + Hermes `app/src/lib/agui/dispatcher.ts`

## 18. Capabilities degraded — tools unavailable (lm-bridge)

- **Symptom**: UI banner `hermes.capabilities.degraded`; agent answers in text only, no tools/MCP/A2UI.
- **Likely cause**: `LLM_BASE_URL` points at chat-only lm-bridge (:3456) without `HERMES_AGENT_LLM_URL` for tool-capable endpoint.
- **Fix**: Set `HERMES_AGENT_LLM_URL` to tool-capable OpenAI-compatible API; `POST /api/capabilities/warm`; check `GET /api/debug/health`.
- **Source**: https://github.com/ag-ui-protocol/ag-ui (capabilities pattern) — see repo `AGENTS.md` / `docs/CAPABILITIES-STAGING.md`

## 19. Agent LLM probe timeout / circuit open

- **Symptom**: Intermittent tool-less turns; health shows agent endpoint failures.
- **Likely cause**: `HERMES_AGENT_LLM_TIMEOUT_MS` exceeded or provider unreachable; circuit breaker opens.
- **Fix**: Increase timeout modestly; fix network/API key; wait for circuit half-open retry; use `GET /api/capabilities?probe=1`.
- **Source**: Repo `server/src/capabilities/router.ts` + `docs/CAPABILITIES-STAGING.md`

## 20. SSE connection drops / proxy buffering

- **Symptom**: Stream freezes mid-run; partial messages; reconnect loops behind nginx/IIS.
- **Likely cause**: Reverse proxy buffering SSE; missing `Cache-Control: no-cache`, `X-Accel-Buffering: no`, or HTTP/2 chunk issues.
- **Fix**: Disable proxy buffering for `/agui`; use HTTP/1.1 for SSE; verify with `curl -N`; check AG-UI transport docs for keep-alive.
- **Source**: https://docs.ag-ui.com/concepts/events

---

*Last curated: 2026-07. Hermes injects this report only when the user explicitly asks for AGUI/A2UI troubleshooting.*
