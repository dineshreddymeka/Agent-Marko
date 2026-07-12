# Cowork + Office (top-level nav)

Short team summary. Full plan lives in the `Cowork Tasks UI` plan document
(`cowork_tasks_ui_e40001aa`).

## Nav (locked)

**Office** is a **top-level** rail item (`/panel/office`), not a Cowork tab.

| Nav item | Route | Purpose |
| --- | --- | --- |
| **Office** | `/panel/office` | **Two tabs (independent):** (A) **Briefing** — Microsoft Graph calendar SSO (`Sign in with Microsoft` → `login.microsoftonline.com`; needs `MICROSOFT_CLIENT_ID` + `MICROSOFT_CLIENT_SECRET`; **not** Open Cowork.exe). (B) **Documents** — document-type gallery (Presentation / Word / Spreadsheet / PDF) that prefills Cowork work requests; optional `OPEN_COWORK_EXE` for local desktop jobs. |
| **Cowork** | `/panel/cowork` (aliases: `tasks`, `scheduled`, `cron`) | **Work requests** \| **Scheduled** — run list/status/results + cron manage/wizard. Setup calls out (A) Microsoft SSO vs (B) Open Cowork. |

Primary rail order: Chat → Workspace → Office → Cowork → MCP → Skills → Settings.
Secondary (after Settings): Memory, Briefing (Microsoft Graph calendar).

Gallery component: `OfficeDocumentsPanel` (exported as `OfficePanel`). Templates live in
`app/src/lib/panels/cowork-work.ts` as `COWORK_OFFICE_TEMPLATES`.

## Database: reuse, no new tables

Cowork keeps using the existing tables — **no migration** adds tables:

- **`sessions`** — one session per task, titled `Cowork: <taskId>` (existing
  convention from `server/src/cowork/persist.ts`). Created at task **start**
  now, so the chat audit link works mid-run.
- **`run_events`** — carries all task fields in payloads (jsonb; session_id +
  `created_at` on every insert — see `docs/DATABASE-DESIGN.md` §1.5):
  - `COWORK_STARTED` payload: `goal`, `deliverableType`, `inputFiles`,
    `autoApprove`.
  - streamed `COWORK_EVENT`s (unchanged).
  - `COWORK_FINISHED` payload: `status` (`done`/`failed`/`aborted`), output
    `files`, `summary`, `error`.
  - Writers: `beginCoworkAudit` (at task start) + `finishCoworkAudit` (at end).
  - Readers: `restoreCoworkTaskFromEvents` for list/detail after restart.
- **`settings`** — optional overrides `cowork.exe` and `cowork.workspace`
  (precedence: settings > env `OPEN_COWORK_*` > default).

The task list and detail endpoints **read those payloads back**, which fixes
the bug where goal/deliverable type disappeared after a server restart. A
STARTED event with no FINISHED and no live process is reported as failed
("Interrupted by server restart"). `status.json` on disk remains a fallback
for pre-refactor sessions.

Why no `cowork_tasks` table: every field is recoverable from
sessions + run_events, the list is capped at 50 items, and we avoid a
migration plus a second source of truth. Revisit only if we need SQL-level
filtering/pagination across task fields.

## Audit gaps — status (verified 2026-07-12)

**Shipped (including Phase: Fixes):**

1. **Setup dead-end** → `GET /api/cowork/setup` + `PUT /api/cowork/setup`
   return/persist real configured state; Setup disclosure shows it live with
   an exe-path save form. Missing exe → POST `/api/cowork/tasks` returns
   **503** `COWORK_EXE_MISSING` (no raw ENOENT). Settings panel shows a
   read-only Ready / Not configured row linking to Cowork Setup.
2. **List loses fields after restart** → payload read-back via
   `restoreCoworkTaskFromEvents` (list + detail), interrupted-run detection;
   `inputFiles` restored from `COWORK_STARTED`.
3. **Abort** → Stop button on queued/running rows calls
   `POST /api/cowork/tasks/:taskId/abort`.
4. **Retry** → uses persisted `inputFiles` (never outbox outputs); legacy
   tasks toast and retry without attachments.
5. **Results poll** → detail query `refetchInterval: 3s` while queued/running.
6. **`cowork.workspace` override** → `resolveCoworkWorkspace` (settings > env)
   in `runCoworkTask` / tool path; REST list/detail use `loadCoworkPathOverrides()`.
7. **Debug cleanup** — `#region agent log` fetch blocks removed from
   `rest/cowork.ts`, `cowork/run-task.ts`, `agui/endpoint.ts`.

## Chat integration (Slice C — streaming)

Open Cowork is reachable from **chat**, not only the Cowork panel:

- Tool `delegate_to_cowork` uses `ToolContext.emit` / `signal` / `sessionId`.
- Live stdio events map to CUSTOM `hermes.cowork.progress` (started / delta /
  tool / ended / error); ToolCallCard shows an “Open Cowork” progress pane.
- `runCoworkTask` accepts `onEvent`, `signal`, `parentSessionId` (audit meta).
- `/cowork [goal]` seeds the composer for a chat handoff (agent should call
  `delegate_to_cowork`).

### Bugfixes (2026-07-12)

- Abort escalates to `client.stop` after soft `session.abort` (no 15m hang).
- Progress uses pre-generated `taskId` (never `pending`).
- Slash `/cowork goal` preserves args from the menu/Enter path.
- Cancel emits tool result + clears stuck ToolCallCards; abort toast is
  "cancelled" not "finished".
- Tool result exposes `status` (lifecycle) + `statusJson` + `parentSessionId`.
- GUI-only Open Cowork 3.3.x still cannot run headless ? setup returns
  `COWORK_HEADLESS_UNSUPPORTED` with build-from-source guidance.
- `delegate_to_cowork` forwards the chat `AbortSignal` into `runCoworkTask`
  and streams `hermes.cowork.progress` via `onEvent` + `chat-progress.ts`.

## Slice C ? chat UI for hermes.cowork.progress (shipped 2026-07-12)

- Dispatcher handles `hermes.cowork.progress` and attaches lines to the active
  `delegate_to_cowork` ToolCallCard (live delta + committed phase lines).
- `ToolCallCard` renders an "Open Cowork progress" section with `aria-live`.
