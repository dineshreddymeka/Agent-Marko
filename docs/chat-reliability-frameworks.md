# Chat Reliability Frameworks & Reference Stack

Curated frameworks, protocols, and patterns for fixing Hermes agent chat UX issues — stuck "starting", thinking loops, stop button stuck, AG-UI event mismatches, A2UI form/PDF gaps, and SSE lifecycle failures.

**Related internal docs:** [`docs/agui-a2ui-top20-issues.md`](./agui-a2ui-top20-issues.md) (symptom catalog), [`AGENTS.md`](../AGENTS.md) (known mock-LLM thinking bug), [`docs/CAPABILITIES-STAGING.md`](./CAPABILITIES-STAGING.md) (degraded tools).

**Last updated:** 2026-07-13

---

## Executive summary

Hermes chat reliability should be anchored on **five primary references**, in priority order:

| Priority | Framework | Role for Hermes |
| -------- | ----------- | ----------------- |
| 1 | **AG-UI Protocol** | Source of truth for event lifecycle, terminal events, reasoning, interrupts, and client `verifyEvents` rules |
| 2 | **CopilotKit (AG-UI reference impl.)** | Battle-tested patterns for reasoning stalls, version alignment, thread replay, and HttpAgent state machine |
| 3 | **Explicit run FSM + watchdogs** | Hermes-local state machine (`runStatus` / `runStage`) with timeout fallbacks — inspired by XState actor lifecycle and CopilotKit run boundaries |
| 4 | **Google A2UI spec** | Form/surface rendering order, validation, and hydration contract for interactive UI in chat |
| 5 | **Vercel AI SDK + SSE reliability guides** | Separate *disconnect* from *cancel*; dedicated stop endpoint; heartbeats and proxy headers |

**Recommended reference stack for the team:**

```
AG-UI event contract (producer + consumer)
  + explicit run FSM (idle → starting → thinking|tool|writing → terminal)
  + terminal-event guarantee (RUN_FINISHED | RUN_ERROR always emitted)
  + client watchdog fallbacks (startup stall, stale running, finally cleanup)
  + server-side explicit cancel (DELETE /agui/:runId) in addition to fetch abort
  + SSE heartbeats + no-buffer headers behind reverse proxies
  + REASONING_* migration (deprecate THINKING_* on server + dispatcher)
  + A2UI createSurface-first + CUSTOM event routing
```

LangGraph interrupt/resume patterns are relevant for **human-in-the-loop** and map cleanly onto AG-UI `RunFinished.outcome.type: "interrupt"` — use when extending approval flows beyond Hermes's current `/api/approval/resolve` path.

---

## Symptom → framework mapping

| Hermes symptom | Recommended framework/pattern | Reference URL | How to apply in hermes-ui |
| -------------- | ----------------------------- | ------------- | ------------------------- |
| Chat blank after agent responds; console `Cannot send 'THINKING_TEXT_MESSAGE_START'…` | AG-UI Reasoning + version alignment | [Reasoning migration](https://docs.ag-ui.com/concepts/reasoning), [pydantic-ai #2687](https://github.com/pydantic/pydantic-ai/issues/2687) | Align `@ag-ui/core` / `@ag-ui/client` (both `^0.0.57` today). Migrate server `server/src/agent/runtime.ts` from `THINKING_*` → `REASONING_*`; update `app/src/lib/agui/dispatcher.ts` handlers. Verify with `curl -N POST /agui` before UI debugging. |
| Stuck on **Starting** (no stream progress) | Explicit run FSM + startup watchdog | Hermes: `app/src/lib/agui/client.ts` (`recoverRunFromStartingStall`, 15s watchdog) | Keep `STARTUP_STALL_TIMEOUT_MS`; ensure first non-lifecycle event or `RUN_STARTED` advances stage off `starting`. Server should emit `RUN_STARTED` immediately after accept (`server/src/agui/endpoint.ts`). Add server heartbeat during long provider resolution. |
| **Thinking** loop / stage never advances | AG-UI reasoning lifecycle + CopilotKit reasoning stall fix | [Reasoning events](https://docs.ag-ui.com/concepts/reasoning), [CopilotKit #3323](https://github.com/CopilotKit/CopilotKit/issues/3323) | Every `REASONING_START` must pair with `REASONING_END`. Auto-close reasoning on phase transition (text/tool). Strip empty reasoning deltas. Dispatcher should treat incomplete reasoning streams as non-fatal but watchdog should force terminal UI cleanup. |
| Red **Stop** button stuck / runStatus `running` forever | Vercel AI SDK cancel pattern + AG-UI terminal events + Hermes finally-guard | [AI SDK stopping streams](https://ai-sdk.dev/docs/advanced/stopping-streams), [Abort vs resume](https://ai-sdk.dev/docs/troubleshooting/abort-breaks-resumable-streams) | `cancelRun()` today only calls `HttpAgent.abortRun()` — also call `DELETE /agui/:runId` (`server/src/agui/endpoint.ts` `handleAguiCancel`). Treat client abort and user stop as explicit cancel, not ambiguous TCP close. `finishLocalRun` + `finally` in `client.ts` and `finalizeRunUi` in `dispatcher.ts` must run on all paths. |
| Stream verification / event sequence rejected | AG-UI `verifyEvents` + CopilotKit ordering fixes | [Events](https://docs.ag-ui.com/concepts/events), [CopilotKit #2684](https://github.com/CopilotKit/CopilotKit/issues/2684) | Upgrade client when out-of-order nested text/tool events are valid per spec. Ensure `RUN_FINISHED` not emitted while open text/tool/reasoning frames exist. Server `finally` block already emits `RUN_FINISHED` if provider returns without terminal event. |
| A2UI form / PDF not rendering | Google A2UI protocol + AG-UI CUSTOM events | [A2UI protocol](https://github.com/google/A2UI/blob/main/specification/v0_9/docs/a2ui_protocol.md), [Renderer guide](https://a2ui.org/guides/renderer-development/) | Always `createSurface` before updates. Route `HermesCustomEvents.A2UI_MESSAGE` through `processA2UIMessage` (`app/src/lib/a2ui/processor.ts`, `app/src/lib/agui/dispatcher.ts`). Persist `a2ui` ref on messages for hydration (`app/src/stores/chat.ts`). |
| SSE freeze mid-run / proxy drop | SSE reliability patterns | [AG-UI events transport](https://docs.ag-ui.com/concepts/events), [Cloudflare SSE guide](https://developers.cloudflare.com/agents/runtime/communication/http-sse/) | Add periodic `: ping` heartbeats in `server/src/agui/endpoint.ts` (today only `: connected` on open). Set `X-Accel-Buffering: no`. Bun idle timeout already raised for `/agui` in `server/src/index.ts`. Record events to `run_events` for replay (`server/src/agui/run-event-buffer.ts`, `app/src/lib/agui/replay.ts`). |
| Tools / A2UI unavailable (degraded banner) | AG-UI capabilities pattern | [`docs/CAPABILITIES-STAGING.md`](./CAPABILITIES-STAGING.md) | Set `HERMES_AGENT_LLM_URL` to tool-capable endpoint; warm with `POST /api/capabilities/warm`. |
| HITL approval stuck / resume failures | AG-UI Interrupts + LangGraph interrupt | [AG-UI Interrupts](https://docs.ag-ui.com/concepts/interrupts), [LangGraph interrupts](https://docs.langchain.com/oss/python/langgraph/interrupts) | Long term: emit `RUN_FINISHED { outcome: { type: "interrupt", … } }` and resume via `RunAgentInput.resume[]`. Short term: wire `respondToApproval` to resume run instead of leaving `runStatus: error` on reject only. |

---

## 1. AG-UI Protocol (primary contract)

**Official docs**

- Events & lifecycle: https://docs.ag-ui.com/concepts/events  
- Reasoning (replaces THINKING_*): https://docs.ag-ui.com/concepts/reasoning  
- Interrupts (HITL): https://docs.ag-ui.com/concepts/interrupts  
- JS SDK events: https://docs.ag-ui.com/sdk/js/core/events  
- Full index: https://docs.ag-ui.com/llms.txt  

**Key rules**

1. **Mandatory boundaries:** Every run emits `RUN_STARTED`, then exactly one terminal event — `RUN_FINISHED` or `RUN_ERROR`.
2. **`verifyEvents` sequencing:** Client rejects invalid sequences (e.g. reasoning message without `REASONING_START`, `RUN_FINISHED` while frames open). Producers must close nested frames before terminal events.
3. **Reasoning lifecycle:** `REASONING_START` → (`REASONING_MESSAGE_*`)* → `REASONING_END`. `THINKING_*` is deprecated and removed in AG-UI 1.0.
4. **Interrupt-aware completion:** `RUN_FINISHED.outcome.type: "interrupt"` pauses for human input; client starts a new run with `RunAgentInput.resume[]`.
5. **Resilience:** Spec allows out-of-order delivery for some nested events in newer clients — upgrade both sides together.

**Hermes-specific notes**

| Area | Path | Gap / action |
| ---- | ---- | ------------ |
| Server event producer | `server/src/agent/runtime.ts` | Still emits `THINKING_*`; migrate to `REASONING_*` per migration table in reasoning docs |
| SSE endpoint | `server/src/agui/endpoint.ts` | Terminal fallback in `finally`; add heartbeat interval; add `X-Accel-Buffering: no` |
| Client HttpAgent | `app/src/lib/agui/client.ts` | Startup watchdog, stale-run recovery, `finally` cleanup — good patterns to keep |
| Event dispatcher | `app/src/lib/agui/dispatcher.ts` | Handles `THINKING_*` only; add `REASONING_*`; `finalizeRunUi` on terminal events |
| Run stage UI | `app/src/stores/chat.ts`, `app/src/components/chat/RunProgress.tsx` | Implicit FSM via `RunStageKind` — document transitions alongside AG-UI events |
| Troubleshoot injection | `server/src/agent/agui-troubleshoot.ts` | Points agents at Top 20 doc when user asks |

**Upstream issues to watch**

- https://github.com/ag-ui-protocol/ag-ui/issues/1176 (duplicate `@ag-ui/core`)  
- https://github.com/pydantic/pydantic-ai/issues/2687 (thinking without THINKING_START)  

---

## 2. CopilotKit (reference implementation)

**Official docs**

- Connect AG-UI agents: https://docs.copilotkit.ai/backend/ag-ui  
- v1.50 threads & persistence: https://docs.copilotkit.ai/whats-new/v1-50  
- Blog — 17 event types: https://www.copilotkit.ai/blog/master-the-17-ag-ui-event-types-for-building-agents-the-right-way  

**Key patterns**

- **HttpAgent / AbstractAgent:** Same subscribe API Hermes uses via `@ag-ui/client` `HttpAgent` in `app/src/lib/agui/client.ts`.
- **ProxiedCopilotRuntimeAgent:** Every run = POST + SSE of AG-UI events — mirrors Hermes `/agui`.
- **Thread replay:** Store raw event stream; on reconnect replay missed events then attach live stream (CopilotKit v1.50). Hermes partial equivalent: `run_events` table + `app/src/lib/agui/replay.ts`.
- **Reasoning stall fix (PR #3526):** Auto-close reasoning when provider omits `reasoning-end`; reject empty deltas — apply same logic in `server/src/agent/runtime.ts`.

**Hermes-specific notes**

- Hermes is **headless** (custom Zustand + dispatcher, not CopilotKit components) but should follow the same event contract and run boundaries.
- CopilotKit #3323 and #2684 are direct precedents for thinking-loop and verifyEvents failures listed in [`docs/agui-a2ui-top20-issues.md`](./agui-a2ui-top20-issues.md).

---

## 3. Explicit run FSM + watchdogs (XState-inspired)

**References**

- XState actors & invoked lifecycle: https://stately.ai/docs/actors  
- Observable/stream actors: https://stately.ai/docs/observable-actors  
- Async workflow modeling: https://www.thisdot.co/blog/using-xstate-actors-to-model-async-workflows-safely  

**Why not adopt XState wholesale?**

Hermes already implements a lightweight FSM in Zustand. XState is the **pattern reference** for:

- Binding stream lifecycle to state (invoke on enter, cleanup on exit)
- Never leaving `running` without a terminal transition
- Watchdog timers as parallel guards

**Hermes run FSM (current)**

```
idle
  └─ runAgent() → running + stage:starting
       ├─ RUN_STARTED / first content → thinking|tool|writing
       ├─ RUN_FINISHED → idle (+ brief stage:done)
       ├─ RUN_ERROR → error|idle
       ├─ cancelRun() / AbortError → idle
       ├─ recoverRunFromStartingStall (15s) → error
       └─ recoverStaleRunIfNeeded() → idle (orphan running)
```

| File | Responsibility |
| ---- | -------------- |
| `app/src/lib/agui/client.ts` | `hasInFlightRun`, `recoverStaleRunIfNeeded`, `recoverRunFromStartingStall`, `startStartupWatchdog`, `finishLocalRun`, `cancelRun` |
| `app/src/lib/agui/dispatcher.ts` | Event-driven stage transitions; `finalizeRunUi` |
| `app/src/stores/chat.ts` | `RunStatus`, `RunStageKind`, streaming buffers |
| `app/src/components/chat/RunProgress.tsx` | Stage strip UI (`STAGE_ORDER`) |
| `server/src/agent/llm.ts` | Hard ceiling so dead bridge cannot leave UI stuck after thinking |

**Recommended additions**

- Document allowed transitions in code comments linking to this doc.
- Optional: formalize as XState machine only if complexity grows (multi-run, interrupt resume, replay reconnect).

---

## 4. Vercel AI SDK (cancel vs disconnect)

**Official docs**

- Stopping streams: https://ai-sdk.dev/docs/advanced/stopping-streams  
- Abort breaks resumable streams: https://ai-sdk.dev/docs/troubleshooting/abort-breaks-resumable-streams  
- ChatTransport (bidirectional cancel): discussed in SDK issues  

**Key insight for Hermes**

SSE is **one-way**. Closing the fetch connection is ambiguous (tab close vs intentional stop). Production systems use:

1. **Disconnect** — client drops SSE; server may continue (for resume) or abort depending on policy.
2. **Explicit cancel** — client calls dedicated stop endpoint; server aborts provider and clears active run.

Hermes already exposes `DELETE /agui/:runId` (`handleAguiCancel`) but `cancelRun()` does not call it yet. Align with AI SDK guidance: **stop button → explicit server cancel**, not only `AbortController`.

**Apply**

```typescript
// app/src/lib/agui/client.ts — pattern to add
export async function cancelRun(): Promise<void> {
  const runId = useChatStore.getState().runId
  if (runId) void fetch(`/agui/${runId}`, { method: 'DELETE', credentials: 'include' })
  // … existing abortRun + local cleanup
}
```

Use `onAbort` / `isAborted` patterns on the server when adding resumable streams later.

---

## 5. LangGraph / LangChain (HITL & streaming)

**Official docs**

- Interrupts: https://docs.langchain.com/oss/python/langgraph/interrupts  
- Human-in-the-loop concepts: https://langchain-ai.github.io/langgraph/concepts/human_in_the_loop/  
- AG-UI LangGraph integration: https://docs.ag-ui.com/concepts/interrupts (framework table)  

**Relevance**

Hermes is not LangGraph-native, but LangGraph's **`interrupt()` + `Command(resume=…)`** model is the backend analogue of AG-UI's **`RunFinished.outcome: interrupt` + `RunAgentInput.resume[]`**.

| LangGraph concept | AG-UI equivalent | Hermes today |
| ----------------- | ---------------- | ------------ |
| `__interrupt__` in stream | `RUN_FINISHED.outcome.type: "interrupt"` | Custom approval via `HermesCustomEvents` + `/api/approval/resolve` |
| Checkpointer + thread_id | `threadId` on all events | Session id as `threadId` |
| Resume with user value | `resume: [{ interruptId, status, payload }]` | Not wired on `/agui` yet |

Use LangGraph docs when implementing multi-step approvals or form-fill interrupts that survive page reload.

---

## 6. Google A2UI (interactive surfaces)

**Official docs**

- Protocol v0.9: https://github.com/google/A2UI/blob/main/specification/v0_9/docs/a2ui_protocol.md  
- v0.8 → v0.9 evolution: https://a2ui.org/specification/v0.9-evolution-guide  
- Renderer development: https://a2ui.org/guides/renderer-development/  

**Key rules**

1. **`createSurface` before any update** for a `surfaceId`.
2. **Globally unique `surfaceId`**; call `deleteSurface` before recreate.
3. **`sendDataModel: true`** requires client to attach data model to action metadata.
4. **VALIDATION_FAILED** → return error to agent for self-correction.

**Hermes code pointers**

| File | Role |
| ---- | ---- |
| `app/src/lib/a2ui/processor.ts` | Surface map, `processA2UIMessage`, hydration |
| `app/src/lib/agui/dispatcher.ts` | CUSTOM `A2UI_MESSAGE` handler |
| `app/src/stores/chat.ts` | `attachA2uiSurface`, message `a2ui` ref |

See Top 20 items #12–#17 in [`docs/agui-a2ui-top20-issues.md`](./agui-a2ui-top20-issues.md).

---

## 7. SSE / streaming reliability

**References**

- AG-UI transport (SSE): https://docs.ag-ui.com/concepts/events  
- Cloudflare Agents SSE: https://developers.cloudflare.com/agents/runtime/communication/http-sse/  
- LLM SSE timeout fix (heartbeats): https://blog.authon.dev/why-your-llm-sse-stream-dies-after-60-seconds-and-how-to-actually-fix-it  
- OpenAPI SSE guidance: https://www.speakeasy.com/openapi/content/server-sent-events  

**Checklist for Hermes `/agui`**

| Item | Status | Action |
| ---- | ------ | ------ |
| `Content-Type: text/event-stream` | ✅ `server/src/agui/endpoint.ts` | — |
| `Cache-Control: no-cache` | ✅ | — |
| `X-Accel-Buffering: no` | ❌ | Add for nginx/IIS fleets |
| Initial `: connected` comment | ✅ `encodeAguiComment` | — |
| Periodic heartbeat (`: ping`) | ❌ | Emit every ~15s during long tool/LLM waits |
| Terminal event on all paths | ✅ `finally` emits `RUN_FINISHED` | Keep |
| Client disconnect → server cancel | ✅ `cancel()` on ReadableStream | Wire client DELETE too |
| Event persistence for replay | ✅ `run_events` + buffer | Expose replay API for reconnect (future) |
| Bun idle timeout | ✅ `server/src/index.ts` | Document for operators |

**Verification command**

```bash
curl -N -X POST http://127.0.0.1:3001/agui \
  -H 'Content-Type: application/json' \
  -d '{"threadId":"test","runId":"test-run","messages":[],"tools":[],"state":{},"context":[]}'
```

Inspect event order and terminal event before debugging the React UI.

---

## 8. Human-in-the-loop & cancellation (combined pattern)

**AG-UI Interrupts:** https://docs.ag-ui.com/concepts/interrupts  

**Rules**

- Interrupt is a **terminal** run outcome, not a hung stream.
- Emit `StateSnapshot` / `MessagesSnapshot` before interrupt `RUN_FINISHED`.
- Resume addresses **all** open interrupts in one `resume[]` array.
- Tool-bound interrupts: audit trail = `ToolCallArgs` (run 1) → `resume.payload` (run 2) → `ToolCallResult` (run 2).

**Hermes cancellation layers (target architecture)**

```
User clicks Stop
  1. DELETE /agui/:runId          → server aborts provider (AbortSignal)
  2. HttpAgent.abortRun()         → client closes SSE
  3. cancelRun() local cleanup    → runStatus idle, clear tools/streaming
  4. RUN_ERROR(code: abort)       → optional; dispatcher treats as idle
```

**Code pointers:** `app/src/lib/agui/client.ts` (`cancelRun`, `respondToApproval`), `server/src/agui/runs.ts` (`cancelRun`), `server/src/agui/endpoint.ts`.

---

## Recommended adoption roadmap

### Phase A — Contract correctness (highest ROI)

1. Migrate `THINKING_*` → `REASONING_*` on server and dispatcher.  
2. Pin/dedupe `@ag-ui/core` and `@ag-ui/client` to the same patch version.  
3. Add `DELETE /agui/:runId` to client `cancelRun()`.  
4. Add SSE heartbeat + `X-Accel-Buffering: no`.

### Phase B — Observability & recovery

1. Log `verifyEvents` failures with runId and event type sequence.  
2. Expose run event replay for reconnect (CopilotKit thread pattern).  
3. Extend startup watchdog to reasoning stall (no `REASONING_END` within N seconds).

### Phase C — HITL & A2UI hardening

1. Adopt AG-UI interrupt outcome for approvals.  
2. A2UI SDK validate-generate-retry loop for agent-emitted surfaces.  
3. Wire `sendDataModel` through action metadata.

---

## Quick link index

| Topic | URL |
| ----- | --- |
| AG-UI events | https://docs.ag-ui.com/concepts/events |
| AG-UI reasoning | https://docs.ag-ui.com/concepts/reasoning |
| AG-UI interrupts | https://docs.ag-ui.com/concepts/interrupts |
| CopilotKit AG-UI backend | https://docs.copilotkit.ai/backend/ag-ui |
| CopilotKit v1.50 threads | https://docs.copilotkit.ai/whats-new/v1-50 |
| Vercel AI SDK stop | https://ai-sdk.dev/docs/advanced/stopping-streams |
| Vercel abort vs resume | https://ai-sdk.dev/docs/troubleshooting/abort-breaks-resumable-streams |
| LangGraph interrupts | https://docs.langchain.com/oss/python/langgraph/interrupts |
| XState actors | https://stately.ai/docs/actors |
| A2UI protocol | https://github.com/google/A2UI/blob/main/specification/v0_9/docs/a2ui_protocol.md |
| CopilotKit reasoning stall | https://github.com/CopilotKit/CopilotKit/issues/3323 |
| CopilotKit event ordering | https://github.com/CopilotKit/CopilotKit/issues/2684 |
| Hermes Top 20 issues | [`docs/agui-a2ui-top20-issues.md`](./agui-a2ui-top20-issues.md) |

---

*This document is the team reference for chat reliability work. Update when adopting new AG-UI versions or changing run lifecycle code.*
