# Open Jarvis — Working Notes (NOT source of truth)

> **Product:** Open Jarvis  
> **Author:** Dinesh Reddy Meka  
> **SOURCE OF TRUTH:** `C:\Users\dines\BMC\BMC-backend\HERMES-UI-PLAN.md`  
> See also `docs/SOURCE-OF-TRUTH.md` and `docs/FEATURE-VERIFICATION.md`. This file tracks local implementation progress and must be reconciled **to** the BMC plan (including **Postgres 17 + pgvector 0.8.5-pg17**). Do not treat hermes-ui checkboxes as authoritative over the BMC checklist.

Rebuild the agent WebUI as **Open Jarvis** from the Hermes WebUI concept (vanilla JS reference) to a modern Bun + React 19 + AG-UI/A2UI stack.

## Task checklist (local progress — reconcile to BMC SoT)

**Last updated:** 2026-07-12 · Repo: [Agent-Marko](https://github.com/dineshreddymeka/Agent-Marko) · **SoT:** BMC-backend/HERMES-UI-PLAN.md

**Policy (pending phases):** all pending work runs under **global auto-approval** (`approval.autoApproveAll=true`, **locked — never off**). System crons fire every **5 minutes** (`*/5 * * * *`), check status, auto-fix safe issues, and **auto-approve any pending HITL approvals**. Keep the laptop awake so the API process and cron scheduler stay running.

| | Phase | Status |
|---|--------|--------|
| ✅ | 1 Scaffold + design system | **Done** — shell, themes, router, tests + build green |
| ✅ | 2 Database | **Done** — migrations 0001–0012, preflight, integrity |
| ✅ | 3 AG-UI server + agent | **Done** — mock LLM + `verify:phase3` |
| ✅ | 4 Chat + AG-UI client | **Wired** — composer, streaming, approval, context ring |
| ✅ | 5 A2UI | **Wired** — custom catalog + Hermes widgets in chat |
| ✅ | 6 Panels | **Wired** — sidebar sessions + `/panel/$name` routes + REST |
| ✅ | 7 Polish | **Done** — mobile nav, Playwright, Lighthouse **95** |
| ✅ | Cross-cutting | **Done** — logging, debug API, replay UI in Settings |
| ✅ | 12a System maintenance cron | **Done** — DB Consistency + Bug Bounty + Status Auto-Approve @ 5 min |
| 🔲 | 8 Office / Microsoft Graph | **Pending** — auto-approve |
| 🔲 | 9 Open Cowork | **Pending** — auto-approve |
| 🔲 | 10 Jarvis indexer REST/tools | **Pending** — auto-approve |
| 🔲 | 11 Smart Cron DAG execution | **Pending** — auto-approve |
| 🔲 | 12b System cron UI polish | **Pending** — surface findings in Tasks panel |
| 🔲 | 13 Hardening leftovers | **Pending** — OTel, lint boundaries, docs restore |
| 🔲 | 14 Chat context manager | **Pending** — same-session A2UI + server history authority |

### Done (Phases 1–7 + maintenance)

- [x] Phase 1a: Bun monorepo scaffold (app/ + server/ + packages/shared), Vite + React 19 + React Compiler + TS strict, Tailwind v4, ESLint/Prettier, bun test setup
- [x] Phase 1b: Primer-token dark design system, app shell (icon rail, sidebar, chat column, right panel), TanStack Router, theme switching
- [x] Phase 2: docker-compose Postgres 17 + pgvector 0.8.5, DDL migrations, Bun.sql client, repositories, db:backup script
- [x] Phase 2 verify: `bun run verify:phase2` (Docker Desktop + Postgres on :5433)
- [x] Phase 2 integrity: migrations `0006`/`0011`/`0012`, `bun run db:preflight`, orphan auto-clean
- [x] Phase 3a: Bun.serve AG-UI server: POST /agui SSE endpoint, RunAgentInput handling, event encoder, run lifecycle, cancellation
- [x] Phase 3b: orchestration layer — AgentProvider interface, native runtime, agui-remote, hermes-python, approval gate
- [x] Phase 3c: embeddings pipeline + pgvector search + context injection
- [x] Phase 3d: MCP client (stdio) + SKILL.md loader
- [x] Phase 3e: better-auth scaffold + compute/`run_code` tool (worker pool)
- [x] Phase 3 mock E2E: `HERMES_MOCK_LLM=1` + `bun run verify:phase3` (no API key)
- [x] Phase 3 real LLM: `bun run verify:phase3:llm` (skips without `LLM_API_KEY`)
- [x] Phase 5 A2UI demos: `bun run verify:a2ui` (cron, memory, skills mock scenarios)
- [x] Phase 4a: chat core — composer, virtualized message list, markdown/Shiki, tool cards, thinking blocks
- [x] Phase 4b: @ag-ui/client wiring — dispatcher, approval resolve API, session load, cancel
- [x] Phase 4c: AgentStatePanel, frontend tools registry, custom Hermes events (context, toasts)
- [x] Phase 5: custom A2UI renderer — catalog + Hermes widgets (skill card, memory editor, cron picker)
- [x] Phase 6: panels — sessions, workspace, skills, memory, cron/tasks, profiles, settings (+ MCP sub-panel)
- [x] Cross-cutting: structured logging, run event recording, debug endpoints + **replay UI**, typed errors, ADRs
- [x] Phase 7: command palette (Ctrl+K), keyboard shortcuts, themes, mobile bottom nav
- [x] Phase 7: Lighthouse verify (`bun run verify:lighthouse`) — score ≥ 90 on built shell
- [x] CI: GitHub Actions (unit tests, mock AG-UI, Playwright, Postgres integration)
- [x] Phase 7: Playwright smoke (`bun run test:e2e`)
- [x] Full stack verify: `bun run verify:all` (all phases green locally)
- [x] Smart Cron v1: workflow JSONB + MCP/skill bindings + wizard + `headlessAutoApprove` + retry
- [x] OpenAPI / Swagger: `/api/docs`, `/api/openapi.json`, `docs/openapi.json`
- [x] Security scanning docs + local `bun run sca:check`
- [x] System cron **DB Consistency** (`*/5 * * * *`) — check → auto-fix orphans / stuck runs / prune
- [x] System cron **Bug Bounty** (`*/5 * * * *`) — check → auto-fix hygiene
- [x] System cron **Status Auto-Approve** (`*/5 * * * *`) — ensure `autoApproveAll`, approve pending HITL, health snapshot
- [x] `GET /api/cron/system` + `workflow.systemKind` in Swagger

### Pending phases (all auto-approval + 5-min status cron)

> **Auto-approval rule:** auto-approve is **locked on** (API/UI cannot turn it off). Boot + Status Auto-Approve cron every 5 minutes re-assert and auto-approve anything still pending. System/cron workflows use `headlessAutoApprove: true`. Keep the laptop from sleeping so cron keeps firing.

#### Phase 8 — Office / Microsoft Graph Briefing · **Pending** · auto-approve
- [ ] Restore/finish `server/src/rest/office.ts` + `OfficePanel` UI
- [ ] Microsoft OAuth connect / callback / disconnect E2E (`MICROSOFT_CLIENT_ID/SECRET`)
- [ ] Briefing endpoint + A2UI surface in chat
- [ ] Document SSO setup (`bun run office:sso-setup`) in README

#### Phase 9 — Open Cowork integration · **Pending** · auto-approve
- [ ] Restore/finish `server/src/rest/cowork.ts` + `CoworkWorkRequests` UI
- [ ] `delegate_to_cowork` tool + `hermes.cowork.progress` streaming
- [ ] Setup preflight (`OPEN_COWORK_EXE`, workspace path) + MCP bridge register
- [ ] Cowork tasks use auto-approve (`OPEN_COWORK_AUTO_APPROVE=true`)

#### Phase 10 — Jarvis indexer / recall · **Pending** · auto-approve
- [ ] Restore/finish `server/src/rest/indexer.ts` + `index_search` agent tool
- [ ] Wire recall into context builder for chat turns
- [ ] Watcher/worker ops docs; drain endpoint in Tasks/Debug UI
- [ ] Indexer jobs never block on HITL (auto-approve)

#### Phase 11 — Smart Cron DAG execution · **Pending** · auto-approve
- [ ] Execute declarative `workflow.steps` (`dependsOn` / `parallelGroup`)
- [ ] Persist step-level run detail; surface in Tasks panel
- [ ] Keep wizard as SoT; headless runs stay auto-approved

#### Phase 12b — System cron UI / ops polish · **Pending** · auto-approve
- [ ] Tasks panel: badge for system jobs + last `detail.maintenance` findings
- [ ] One-click “Run maintenance now” for DB / Bug Bounty / Status Auto-Approve
- [ ] Alert when Status Auto-Approve finds DB down or autoApproveAll off

#### Phase 13 — Hardening leftovers · **Pending** · auto-approve
- [ ] Optional OpenTelemetry spans (env-gated OTLP exporter)
- [ ] ESLint `import/no-restricted-paths` (app ↛ server)
- [ ] Restore API tokens REST handler if still imported by router
- [ ] Restore missing tracker docs or drop dead links (`SOURCE-OF-TRUTH`, `FEATURE-VERIFICATION`, `DATABASE-DESIGN`, `PARALLEL-AGENT-PLAN`)
- [ ] MCP HTTP transport file restore if still referenced

#### Phase 14 — Chat context manager · **Pending** · auto-approve
- [ ] Same-session A2UI actions (stop minting new `threadId` on form submit)
- [ ] Server-authoritative history (tool_calls paired + persisted)
- [ ] Multi-turn intent / `session_state` (not last-message regex only)
- [ ] Link `message.a2ui` reliably for bubble mount

### Explicitly descoped (not pending)
- Voice / TTS
- Multi-user teams / org ACLs
- A2A protocol (later extension)
- Wiring Snyk/Sonar into GitHub Actions (enterprise tools stay outside; see `docs/SECURITY-SCANNING.md`)

### System cron reference (every 5 minutes)

| Job | `systemKind` | What it does |
|-----|--------------|--------------|
| DB Consistency | `db-consistency` | Orphan FK nulling, stale MCP/skill bindings, stuck `cron_runs` → failed, event retention prune |
| Bug Bounty | `bug-bounty` | Path-jail / XSS hygiene check → safe autofix; stale bindings / stuck runs |
| Status Auto-Approve | `status-auto-approve` | Force `autoApproveAll` on; auto-approve pending tool approvals; DB/indexer/cron status snapshot |

### Laptop always-on (cron stays alive)

Auto-approve is **never off**. To keep 5-minute system crons firing on a Windows laptop:

```powershell
# Prevent sleep while the Open Jarvis API is running (run elevated or as user)
powercfg /change standby-timeout-ac 0
powercfg /change monitor-timeout-ac 0
# Or keep awake for this session:
powershell -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Application]::SetSuspendState('None', $false, $false)"
```

Prefer leaving the machine plugged in with sleep disabled while `bun run dev` / the API is up.

API: `GET /api/cron/system` · force: `POST /api/cron/{id}/run` · results: `cron_runs.detail.maintenance`

---

## 1. Locked decisions and constraints

- Location: new project at `C:\Users\dines\BMC\hermes-ui` (upstream [nesquena/hermes-webui](https://github.com/nesquena/hermes-webui) used only as feature/API reference).
- Runtime and tooling: **Bun** everywhere — package manager, script runner, test runner (`bun test`), backend server runtime.
- Frontend: **React 19 + React Compiler + Vite (SWC) + TypeScript strict**. Chosen for the only stable first-party AG-UI/A2UI support plus richest ecosystem; speed engineered via compiler, virtualization, code-splitting, workers.
- Protocols: **AG-UI** (agent-user event stream; CopilotKit SDK) and **A2UI** (Google's declarative generative UI, v0.9 line) carried over AG-UI.
- Database: **Postgres 17 + pgvector 0.8.5** (`pgvector/pgvector:0.8.5-pg17`) per BMC SoT — local docker may still be on pg17 until W3 migrates; bind-mounted data dir. Access via native **`Bun.sql`**; **Drizzle ORM** for schema/migrations only.
- Design: dark-first, **GitHub Primer** design tokens, Cursor-style layout.
- Licensing hard rule: **MIT / Apache-2.0 / PostgreSQL License only.** No GPL, AGPL, SSPL, BSL anywhere in the dependency tree (rules out Open WebUI, MongoDB, Redis). Every new dependency gets a license check before install.
- Big-company backing: React (Meta), TypeScript (Microsoft), A2UI (Google), AG-UI (CopilotKit + Microsoft Agent Framework + Google ADK integrations), Primer (GitHub), Postgres (industry), Vite (VoidZero), shadcn/ui (Vercel-affiliated), Bun (Oven).
- Accelerators: **assistant-ui** (MIT) headless chat primitives evaluated for Phase 4 chat core; **AG-UI Dojo** used as the reference implementation for protocol features.

## 2. Monorepo layout

```
hermes-ui/
├─ package.json                 # workspaces: app, server, packages/*; scripts below
├─ bunfig.toml
├─ tsconfig.base.json           # strict, path aliases @app/*, @server/*, @shared/*
├─ docker-compose.yml           # Postgres 17 + pgvector, pinned tag, bind mount
├─ .env.example                 # DATABASE_URL, HERMES_DATA_DIR, HERMES_BACKUP_DIR,
│                               # LLM_BASE_URL, LLM_API_KEY, EMBEDDINGS_MODEL...
│  (PG data + backups live OUTSIDE the repo: C:\hermes-data\{postgres,backups})
├─ scripts/
│  ├─ db-backup.ts              # bun run db:backup → timestamped pg_dump
│  └─ db-restore.ts
├─ packages/
│  └─ shared/                   # types shared by app+server
│     ├─ src/agui-events.ts     # custom event names + payload types
│     ├─ src/api-types.ts       # REST DTOs (Session, Message, Skill, MemoryEntry, CronJob, Profile)
│     └─ src/a2ui-catalog.ts    # custom catalog component ids + prop schemas
├─ server/                      # Bun AG-UI server + Hermes agent runtime
│  └─ src/ (see §6)
└─ app/                         # React frontend
   └─ src/ (see §4)
```

Root scripts: `bun run dev` (concurrent server `bun --hot` + Vite), `bun run db:up|db:down|db:backup|db:restore`, `bun run migrate`, `bun test`, `bun run build`, `bun run lint`.

## 3. Key dependencies (all permissive-licensed)

- Frontend: `react@19`, `react-dom@19`, `babel-plugin-react-compiler` (via `@vitejs/plugin-react-swc` setup), `@tanstack/react-router`, `@tanstack/react-query` (+ `query-persist-client` + IndexedDB persister), `@tanstack/react-virtual`, `zustand`, `tailwindcss@4`, Radix primitives / shadcn-style components, `@primer/primitives` (design tokens), `lucide-react` (icons), `react-markdown` + `remark-gfm`, `shiki`, `katex`, `mermaid` (lazy), `cmdk` (palette), `@ag-ui/client`, `@a2ui/react` + A2UI web core, optionally `@assistant-ui/react`.
- Server: `@ag-ui/core` (+ encoder), `drizzle-orm` + `drizzle-kit`, `zod` (validation at boundaries), `croner` (cron scheduling, MIT). Postgres via built-in `Bun.sql` — no driver dependency.
- Exact versions resolved with `bun add` at implementation time (latest stable); each checked against the license rule.

## 4. Frontend architecture (`app/src/`)

```
main.tsx, router.tsx
styles/            tokens.css (Primer→CSS vars), themes (dark default, dim, light)
lib/               agui/ (client singleton, event dispatcher, frontend-tool registry)
                   a2ui/ (message processor, catalog registration)
                   api.ts (typed fetch wrapper), markdown/ (worker client), utils
stores/            chat.ts, sessions.ts, agentState.ts, ui.ts, settings.ts (Zustand)
workers/           shiki.worker.ts (highlight off main thread)
components/
  shell/           IconRail, Sidebar, ChatColumn, RightPanel, StatusFooter (context ring)
  chat/            Composer (slash autocomplete, attachments), MessageList (virtualized),
                   MessageBubble, StreamingMarkdown, CodeBlock (worker Shiki + copy),
                   ToolCallCard (live args → result, collapsible), ThinkingBlock,
                   ApprovalCard (HITL), RunProgress (steps, cancel), ErrorBanner
  a2ui/            A2UISurface (inline in transcript), catalog/ (standard mapping),
                   hermes-widgets/ (SkillCard, MemoryEditor, CronPicker)
  panels/          SessionsPanel, WorkspacePanel (file tree + preview), SkillsPanel,
                   MemoryPanel, CronPanel, ProfilesPanel, SettingsPanel
  state/           AgentStatePanel (shared-state todo/plan viewer, editable)
  common/          CommandPalette (Ctrl+K), Kbd, EmptyState, Skeleton, Toasts
routes/            /  /session/$id  /panel/$name (code-split)
```

Data flow: AG-UI SSE events → dispatcher → Zustand stores → components. REST (sessions list, skills, cron, memory, settings) → TanStack Query with IndexedDB persistence. Streaming tokens batched with `requestAnimationFrame` flush (~60fps) into the chat store.

### Design system details
- Primer dark token values mapped to CSS variables consumed by Tailwind v4 `@theme` (canvas `#0d1117`, canvas-subtle `#161b22`, border `#30363d`, fg `#e6edf3`, fg-muted `#8b949e`, accent `#2f81f7`, success `#3fb950`, danger `#f85149`, attention `#d29922`).
- Typography: system font stack for UI, monospace stack for code; 14px base, compact line heights like Cursor.
- Layout: 48px icon rail; 280px collapsible sidebar; centered chat column max-width ~48rem; 320px right panel (toggleable); sticky composer; footer with model name + context-usage ring.
- Motion: 120–160ms ease-out transitions; skeletons for loading; no layout shift during streaming (reserved space for tool cards).

## 5. Protocol integration — every feature used

### AG-UI (client `lib/agui/`, server §6)
- Event coverage and UI mapping:
  - `RUN_STARTED / RUN_FINISHED / RUN_ERROR` → RunProgress, cancel button, error banner with retry.
  - `STEP_STARTED / STEP_FINISHED` → step chips in RunProgress.
  - `TEXT_MESSAGE_START / CONTENT / END` → StreamingMarkdown (batched).
  - `THINKING_*` → ThinkingBlock (collapsed by default, throttled render).
  - `TOOL_CALL_START / ARGS / END` + result → ToolCallCard with live-filling args JSON, then result body (code/diff/table aware).
  - `STATE_SNAPSHOT / STATE_DELTA` (JSON Patch) → AgentStatePanel (todos, plan, workspace context); user edits produce state mutations sent back on next run input.
  - `MESSAGES_SNAPSHOT` → session recovery after reload mid-run.
  - `CUSTOM` → Hermes extensions: `hermes.context` (token usage ring), `hermes.cron.fired` (toast), `hermes.skill.learned` (toast), `hermes.title` (auto session title).
- Frontend tools registry: client-registered tools the agent can call — `open_file_preview`, `switch_panel`, `render_chart`, `set_theme`. Declared in `RunAgentInput.tools`, executed in browser, result returned as tool message.
- Human-in-the-loop: dangerous server tools (`run_shell`, `write_file`, `delete_*`) emit an approval interrupt → ApprovalCard (Approve / Reject / Always allow this session) → response resumes the run.
- Predictive/optimistic updates on state deltas, reconciled on snapshot.
- Thread/run model: `threadId` = session id, `runId` per message turn — multi-agent/subagent ready.

### A2UI (client `lib/a2ui/`)
- A2UI messages arrive as AG-UI custom events (`a2ui.message` JSONL payloads) → MessageProcessor → `A2UISurface` rendered inline at its transcript position, streaming progressively with skeletons.
- Standard catalog mapped to design-system components: Text, Image, Button, TextField, Select/Radio/Checkbox, DateTime, Slider, List, Table (virtualized), Card, Tabs, Divider, ProgressBar, Video/Audio.
- Custom Hermes catalog (in `packages/shared/a2ui-catalog.ts`): `hermes:SkillCard`, `hermes:MemoryEntryEditor`, `hermes:CronSchedulePicker`, `hermes:FileDiff`.
- `action` / `actionResponse` round-trips: user interactions post back through the AG-UI run so agent-generated forms are fully functional.
- Safety: declarative only; renderer never evaluates agent-provided code; all bindings resolved against the surface data model.

## 6. Backend — Bun AG-UI orchestration server (`server/src/`)

### Framework-agnostic orchestration layer
The server is an **orchestrator, not a single hard-coded agent**. Everything speaks AG-UI, so any agent framework that supports AG-UI plugs in without touching the frontend:

```mermaid
flowchart LR
    subgraph frontend [React Frontend]
        aguiClient["@ag-ui/client"]
    end
    subgraph orchestrator [Bun Orchestration Server]
        endpoint["AG-UI Endpoint"]
        registry[AgentProvider Registry]
        nativeAgent[Native Hermes Runtime]
    end
    subgraph frameworks [Any AG-UI Framework Service]
        langgraph[LangGraph]
        crewai[CrewAI]
        others[Mastra / PydanticAI / ADK / Strands / ...]
    end
    aguiClient <-->|"SSE"| endpoint
    endpoint --> registry
    registry -->|"provider: native"| nativeAgent
    registry -->|"agui-remote proxy"| langgraph
    registry -->|"agui-remote proxy"| crewai
    registry -->|"agui-remote proxy"| others
    nativeAgent -->|"delegate_to_agent"| registry
```

- `agent/provider.ts` defines an **`AgentProvider` interface**: `run(input: RunAgentInput, emit: EventEmitter, signal: AbortSignal)`. All providers emit the same AG-UI event stream.
- Providers implemented behind it:
  1. **`native`** — our from-scratch Hermes runtime in Bun/TS (default; full control, memory/skills/cron integration).
  2. **`agui-remote`** — generic proxy to ANY external AG-UI endpoint. This instantly supports every framework with official AG-UI integration: **LangGraph, CrewAI, Mastra, Pydantic AI, Agno, LlamaIndex, AG2, Microsoft Agent Framework, AWS Strands, Google ADK** — each runs as its own service (Python/TS/whatever) and we just forward `RunAgentInput` and relay its event stream, layering Hermes memory/skills context on the way in and persistence on the way out.
  3. **`hermes-python`** — the legacy hermes-webui bridge (same interface).
- **Per-profile provider selection**: each profile (`profiles.provider` + `profiles.provider_config` JSONB: endpoint URL, auth header, extra context) picks which framework serves that session. Switching frameworks = switching profiles in the UI.
- **Multi-agent orchestration**: the native runtime gets a `delegate_to_agent` tool — it can dispatch a subtask to any configured provider (e.g. hand a research task to a LangGraph service, a crew task to CrewAI), stream the sub-run's events nested under the parent transcript (AG-UI thread/run IDs already model this), and consume the result. A2A protocol adoption is a later extension point; provider registry is where it would land.
- License note: framework services run out-of-process behind HTTP, so their licenses don't enter our dependency tree; still, documented recommendations stick to permissive ones (verify per framework at integration time).

### MCP integration (Model Context Protocol)
The native runtime is an **MCP client** — any MCP server's tools become Hermes tools:

- `mcp/manager.ts`: connects configured MCP servers on boot (both transports: **stdio** — spawn local command via `Bun.spawn`; **HTTP/streamable + SSE** — remote servers), handles handshake, capability discovery, reconnect/backoff, and auth headers.
- Discovered **tools** are namespaced (`mcp:<server>/<tool>`) and merged into the agent tool registry with their JSON schemas; all MCP tools default to `dangerous` (approval-gated) unless whitelisted per server. **Resources** are exposed to the context builder (agent can read them); **prompts** surface as slash commands in the composer (`/mcp:<server>:<prompt>`).
- Config persisted in a new `mcp_servers` table (name, transport, command/url, env/headers JSONB, enabled, tool whitelist); managed in a **Settings → MCP panel** (add/edit/enable servers, view discovered tools, test connection).
- Tool-call UI: MCP calls render in the same ToolCallCard with the server badge.
- SDK: official `@modelcontextprotocol/sdk` (MIT — passes license rule).

### Skills — SKILL.md open standard
Skills follow the **SKILL.md folder standard** (same format Hermes/Claude/Cursor use), not a proprietary format:

- `skills/loader.ts`: skill sources configurable — local folder (`./skills/`), additional user paths, and **git repos** (cloned/pulled into a cache dir). Each skill = folder with `SKILL.md` (frontmatter: name, description, triggers) + supporting files.
- Loader syncs skills into the `skills` table (+ embeddings) on boot and on demand (`POST /api/skills/sync`); `body_md` holds the SKILL.md content; `source` column records origin (builtin | user-folder | git:<url> | learned).
- At run time the context builder semantically matches top-k skills against the user request and injects the matched SKILL.md bodies (token-budgeted).
- **Learning loop** (the Hermes signature feature): a `skill_save` tool lets the agent write a new SKILL.md folder after mastering a recurring task — saved to a `learned/` skills dir, synced into the DB, editable in the Skills panel, refined on subsequent corrections.
- Skills panel additionally gets: source badges, sync button, git-repo source management, and export of learned skills.

### Module layout

```
index.ts            Bun.serve: routes, CORS, static prod serving
agui/               endpoint.ts (POST /agui → SSE), encoder.ts, runs.ts (registry,
                    cancellation via AbortController), events.ts (typed emitters)
agent/              provider.ts (AgentProvider interface + registry),
                    providers/ (native.ts, agui-remote.ts, hermes-python.ts),
                    runtime.ts (native agentic loop), llm.ts (OpenAI-compatible streaming client),
                    prompts.ts (SOUL.md-style system prompt builder), context.ts
                    (memory recall + skill matching injection), approval.ts (HITL gate)
agent/tools/        registry.ts + shell.ts, files.ts (workspace FS ops), web.ts,
                    memory.ts (save/search), skills.ts, cron.ts, a2ui.ts (emit surfaces),
                    code.ts (sandboxed run_code)
mcp/                manager.ts (client connections, discovery, reconnect),
                    transports (stdio via Bun.spawn, HTTP/SSE), tool-bridge.ts
skills/             loader.ts (SKILL.md parser, folder/git sources, sync), learn.ts
auth/               better-auth config, route guards, api tokens
compute/            pool.ts (Bun Workers thread pool)
bridge/             hermes-python.ts (optional adapter: proxies to existing hermes-webui
                    SSE backend and translates its events → AG-UI events; enabled by env)
db/                 client.ts (Bun.sql pool), schema.ts (Drizzle), migrate.ts,
                    repositories/ (sessions, messages, memory, skills, cron, profiles)
vector/             embeddings.ts (OpenAI-compatible endpoint, batching, retry),
                    search.ts (pgvector HNSW queries), indexer.ts (async embed queue)
rest/               sessions.ts, messages.ts, skills.ts, memory.ts, cron.ts,
                    profiles.ts, settings.ts, workspace.ts (file tree/read/write)
cron/               scheduler.ts (croner; jobs run agent turns headlessly, results
                    stored + notified via custom event to open clients)
```

- REST API (JSON, zod-validated): `GET/POST/PATCH/DELETE /api/sessions`, `GET /api/sessions/:id/messages`, `GET /api/search?q=` (FTS + semantic), CRUD for `/api/skills`, `/api/memory`, `/api/cron`, `/api/profiles`, `GET/PUT /api/settings`, `GET /api/workspace/tree|file`.
- Agent loop: build context (profile system prompt + semantic memory recall + matched skills) → stream LLM → parse tool calls → approval gate if dangerous → execute → loop until done; every event mirrored to AG-UI stream and persisted to `messages`.
- Model-agnostic: any OpenAI-compatible endpoint (OpenRouter, vLLM/Ollama serving Hermes models, Bedrock proxy) via `LLM_BASE_URL`/`LLM_API_KEY`.

## 7. Database schema (Postgres 17 + pgvector 0.8.5)

```sql
CREATE EXTENSION IF NOT EXISTS vector;

sessions(id uuid pk, title text, group_name text, profile_id uuid null,
         pinned bool, archived bool, created_at, updated_at)
messages(id uuid pk, session_id fk cascade, run_id uuid, role text,
         content text, tool_name text null, tool_args jsonb null,
         tool_result jsonb null, thinking text null, a2ui jsonb null,
         tokens int, created_at,
         search tsvector GENERATED (to_tsvector('english', content)) STORED,
         embedding vector(1024) null)
memory(id uuid pk, kind text  -- semantic|episodic|preference,
       content text, source_session uuid null, importance real,
       embedding vector(1024), created_at, last_accessed)
skills(id uuid pk, name text unique, description text, body_md text,
       source text default 'user-folder',  -- builtin|user-folder|git:<url>|learned
       path text null, triggers jsonb null,
       usage_count int, success_count int, embedding vector(1024),
       created_at, updated_at)
mcp_servers(id uuid pk, name text unique, transport text,  -- stdio|http
            command text null, url text null, env jsonb, headers jsonb,
            enabled bool, tool_whitelist jsonb, created_at)
cron_jobs(id uuid pk, name text, schedule text, prompt text, profile_id uuid,
          enabled bool, last_run timestamptz, next_run timestamptz)
cron_runs(id uuid pk, job_id fk, started_at, finished_at, status text,
          session_id uuid null, error text null)
profiles(id uuid pk, name text, system_prompt text, model text,
         temperature real, provider text default 'native',
         provider_config jsonb, settings jsonb)
settings(key text pk, value jsonb)
-- auth (managed by better-auth migrations): user, session, account, verification
-- api_tokens(id, user_id, name, token_hash, scopes jsonb, last_used, created_at)

-- Indexes
GIN(messages.search);
HNSW(messages.embedding vector_cosine_ops);
HNSW(memory.embedding);  HNSW(skills.embedding);
btree(messages.session_id, created_at);
```

- Migrations via drizzle-kit, run by `bun run migrate` (idempotent, called on server boot in dev).
- Embedding dimension configurable (default 1024) — set from `EMBEDDINGS_MODEL` at first migrate.
- Indexer embeds asynchronously post-insert; search degrades gracefully to FTS-only when embeddings pending.

## 8. Docker + volume safety

`docker-compose.yml`: `pgvector/pgvector:0.8.5-pg17` (exact tag pinned), `ports: 5433:5432`.

**Data volume lives in a separate location, outside the project folder**: the bind mount path comes from env — `volumes: ${HERMES_DATA_DIR:-C:/hermes-data}/postgres:/var/lib/postgresql/data` (`HERMES_DATA_DIR` in `.env`, default `C:\hermes-data` on this machine). Consequences:

- Deleting, moving, or re-cloning the `hermes-ui` project never touches the database.
- `docker compose down -v` cannot destroy it (bind mounts are not managed volumes).
- Same for backups: `HERMES_BACKUP_DIR` (default `C:\hermes-data\backups`) keeps dumps out of the repo too.
- **PG17 volume path**: mount `${HERMES_DATA_DIR}/postgres` → `/var/lib/postgresql/data`.

Healthcheck `pg_isready`, `restart: unless-stopped`. Backup: `bun run db:backup` → `${HERMES_BACKUP_DIR}/hermes-YYYYMMDD-HHmmss.sql` via `pg_dump`; restore script + README section on moving the data folder between machines.

## 9. Performance budget and low-latency engineering

End-to-end latency chain, optimized per hop:
- **LLM hop (dominant)**: stream immediately (zero buffering), persistent keep-alive connection to the LLM endpoint (no per-request TLS handshake), stable system-prompt/skills prefix ordering to exploit provider **prompt caching** for faster time-to-first-token.
- **Server hop**: single Bun process (no gateway/microservice hops), `Bun.serve` native HTTP, SSE frames flushed on emit (no compression buffering on stream path).
- **DB hop**: localhost Postgres, `Bun.sql` prepared statements + pipelining, HNSW/GIN indexes; message persistence is **async off the critical path** — user-visible streaming never waits on a write.
- **Context hop**: embeddings precomputed by the background indexer, so recall at send-time is one indexed query.
- **Render hop**: rAF token batching, 10Hz thinking throttle, virtualization, worker-offloaded Shiki, React Compiler.
- **Perceived**: optimistic message append, IndexedDB warm cache on reload, predictive state updates.

Budgets:
- First load < 200KB gzipped JS for the shell (panels, Mermaid, KaTeX, xterm lazy-loaded).
- Streaming: token batching per animation frame; thinking events throttled ~10Hz; message list virtualized (TanStack Virtual) — smooth at 10k+ messages.
- Shiki in a Web Worker; markdown parsed incrementally on stream end-of-block.
- React Compiler on; no unmemoized hot paths; Zustand selectors keep re-renders scoped.
- DB: HNSW ANN + GIN FTS; repository queries paginated (cursor-based on `created_at,id`).

## 10. Testing

- `bun test` server-side: repositories (against dockerized PG), agent loop with fake LLM (scripted SSE), AG-UI event encoder golden tests, approval gate, vector search ranking sanity.
- Frontend: Vitest-compatible `bun test` + Testing Library for stores, dispatcher, ApprovalCard, A2UI catalog rendering; one Playwright smoke (send message → streamed reply → tool card → approval) — optional, added in Phase 7.

## 11. Security, auth, and heavy computation

### Authentication (complex auth, built in from Phase 3)
- **better-auth** (MIT, TypeScript-native, works first-class with Bun + Drizzle/Postgres) as the auth layer — not a hand-rolled token:
  - Email/password with secure session cookies (httpOnly, SameSite), session table in Postgres.
  - **OAuth providers** configurable (GitHub, Google) for one-click sign-in when exposed beyond localhost.
  - Optional 2FA (TOTP) plugin for remote exposure.
  - **Single-user bootstrap**: first run creates the owner account; registration locked by default (`ALLOW_SIGNUP=false`), so local UX stays frictionless.
  - Middleware guards everything: REST routes, the AG-UI endpoint (session or bearer token), and SSE reconnects; per-user rows ready if multi-user is ever enabled (`user_id` FK on sessions/memory/skills — nullable, defaulting to owner).
- API tokens for programmatic access (e.g. invoking the agent from scripts/CI): hashed in DB, scoped, revocable in Settings.

### Heavy calculations
- **Bun Workers thread pool** (`server/src/compute/pool.ts`) for CPU-bound work so the event loop never blocks the SSE streams: embedding batch pre/post-processing, large file parsing/diffing, FTS re-indexing, export generation.
- **Agent `run_code` tool** (code-interpreter style, dangerous → approval-gated): executes JS/TS snippets in an isolated Bun subprocess with resource limits (timeout, memory cap, no network by default, temp-dir sandbox) — gives the agent real computation ability (math, data crunching over workspace files) without risking the server process. Python optional later via the same subprocess pattern if installed.
- Postgres does the data-heavy math where it's fastest: aggregations, vector distance, FTS ranking — not in JS.

### Hardening
- Server binds `127.0.0.1` by default; auth required automatically when bound to non-localhost.
- All REST bodies zod-validated; workspace file ops path-normalized and jailed to configured workspace root.
- Dangerous tools always behind the approval gate unless session-whitelisted; A2UI renders declaratively (no code eval); CSP headers in prod build.
- Secrets only via `.env` (gitignored), never persisted to DB or logs.

## 11b. Maintainability and debuggability

### Maintainability
- **Types as the single source of truth**: `packages/shared` holds all DTOs, event payloads, and A2UI catalog schemas — frontend and server import the same types; zod schemas at boundaries give runtime validation AND inferred static types (no drift).
- **Registry pattern everywhere extensible**: agent tools, providers, frontend tools, slash commands, A2UI catalog components are all registries — adding one is a new file + one registration line, never edits across the codebase.
- **Strict module boundaries**: ESLint `import/no-restricted-paths` rules — e.g. `rest/` can't import `agent/` internals, components can't import repositories; keeps the dependency graph clean as the code grows.
- **Versioned, append-only migrations** (drizzle-kit) — schema history is reviewable; no ad-hoc DB edits.
- **ADRs (Architecture Decision Records)** in `docs/adr/` — every decision from this plan (Bun, Postgres+pgvector, AG-UI orchestration, better-auth...) recorded with context, so future contributors know *why*.
- Enforced formatting/linting (Prettier + ESLint flat config) in a pre-commit hook and `bun run lint` gate; conventional commit messages; `LICENSES.md` kept current by the dependency license check.

### Debuggability
- **Structured logging**: JSON logs with levels via a thin logger (`server/src/log.ts`), every line carrying correlation IDs — `threadId` (session), `runId`, `userId`, `toolCallId`. `LOG_LEVEL` env; pretty printing in dev, JSON in prod.
- **Run event recording + replay (the killer feature)**: the raw AG-UI event stream of every run is already persisted; a **debug panel** in the UI (Settings → Debug) can inspect any past run event-by-event and **replay it through the frontend dispatcher** — reproduce any UI bug without re-calling the LLM.
- **LLM request/response dump** behind `DEBUG_LLM=1`: full prompts, tool schemas, raw deltas written to rotating files in `${HERMES_DATA_DIR}/logs` (API keys redacted) — debug prompt issues offline.
- **Diagnostics endpoints**: `GET /api/debug/health` (DB pool, MCP server states, active runs, memory usage, embedding queue depth), `GET /api/debug/runs/:id/events` (raw recorded stream).
- **Frontend**: global error boundary with "Copy diagnostics" (app version, last 50 events, store snapshot); TanStack Query Devtools + Zustand devtools middleware in dev builds; source maps shipped in prod build for readable stack traces.
- **OpenTelemetry-ready (optional)**: `@opentelemetry/api` (Apache 2.0) spans around run → LLM call → tool exec → DB query; exporter off by default, one env var to point at any OTLP collector if ever needed.
- **Error taxonomy**: typed error classes (`LlmError`, `ToolError`, `ProviderError`, `DbError`) so logs, AG-UI `RUN_ERROR` events, and UI banners all carry a machine-readable `code` + human message.

## 12. Phase-by-phase execution detail

### Phase 1 — Scaffold + design system
Steps, in order:
1. `bun init` monorepo root; `package.json` workspaces `["app","server","packages/*"]`; `tsconfig.base.json` (strict, `@app/* @server/* @shared/*` aliases); `.gitignore` (node_modules, data/, backups/, .env, dist).
2. Scaffold `app/`: `bun create vite` (react-swc-ts template), add React 19, enable React Compiler in the SWC/babel pipeline, TanStack Router with file-based routes `/`, `/session/$id`, `/panel/$name` (lazy).
3. Tailwind v4 setup; `styles/tokens.css` defining Primer dark palette as CSS vars, wired into `@theme`; dim + light variants behind `data-theme` attribute; `ui.ts` store persists choice to `localStorage`.
4. Build shell components: `IconRail` (chat, workspace, skills, memory, cron, settings icons), `Sidebar` (empty session list placeholder, collapse toggle + `Ctrl+B`), `ChatColumn` (empty state), `RightPanel` (toggleable, `Ctrl+Alt+B`), `StatusFooter` (model name placeholder + context ring SVG stub).
5. Scaffold `server/`: `index.ts` with `Bun.serve` returning `/api/health`; `bun --hot` dev script. Scaffold `packages/shared` with empty typed modules.
6. Root scripts + dev runner (a small Bun script spawning both processes); ESLint flat config + Prettier; `bun test` smoke test in each workspace.
7. Verify on Windows: `bun run dev` boots both, HMR works, health endpoint reachable.

Deliverable: empty but navigable Cursor-look shell. AC: Lighthouse perf ≥ 95; `bun test` green; theme toggle + panel collapse work.

### Phase 2 — Database (Postgres 17 + pgvector 0.8.5)
1. `docker-compose.yml`: `pgvector/pgvector:0.8.5-pg17`, port 5433, bind mount `${HERMES_DATA_DIR:-C:/hermes-data}/postgres:/var/lib/postgresql/data` (separate location outside the project), healthcheck, `restart: unless-stopped`; `.env.example` with `DATABASE_URL=postgres://hermes:hermes@localhost:5433/hermes`, `HERMES_DATA_DIR`, `HERMES_BACKUP_DIR`.
2. `db/client.ts`: `Bun.sql` pool from env; ping-on-boot with clear error if PG down.
3. `db/schema.ts` (Drizzle): all tables from §7 including generated `tsvector` column (raw SQL migration where Drizzle lacks support), `vector(1024)` columns, HNSW + GIN + btree indexes; `migrate.ts` runs drizzle-kit migrations idempotently; embedding dimension read from env at first migration.
4. Repositories (`db/repositories/*`): typed CRUD + pagination (cursor on `created_at,id`): sessions (with group aggregation), messages (bulk insert per run, FTS query), memory, skills, cron (+cron_runs), profiles, settings (key-value upsert).
5. `scripts/db-backup.ts` / `db-restore.ts` shelling to `pg_dump`/`psql` inside the container (`docker compose exec`); README section.
6. Tests: repository suite against the dockerized PG (test database `hermes_test`, truncated between tests).

AC: `bun run db:up && bun run migrate` from clean checkout succeeds; repo tests green; backup file restores into a fresh container.

### Phase 3 — AG-UI server, agent runtime, vector pipeline
1. AG-UI endpoint: `POST /agui` accepts `RunAgentInput` (threadId, runId, messages, tools, state, context); responds `text/event-stream`; `agui/encoder.ts` serializes protocol events; `agui/runs.ts` registry keyed by runId with `AbortController` (client disconnect or `DELETE /agui/:runId` cancels).
2. LLM client (`agent/llm.ts`): OpenAI-compatible `/chat/completions` streaming (fetch + SSE parse), supports reasoning deltas, tool-call deltas, usage stats; retries with backoff; model/temperature from profile.
3. Orchestration layer: `AgentProvider` interface + registry; `providers/agui-remote.ts` (forward `RunAgentInput` to a configured AG-UI endpoint, relay/persist its event stream, inject Hermes context); provider resolved per profile; `delegate_to_agent` tool in the native runtime streaming nested sub-runs.
4. Native agent loop (`agent/runtime.ts`): assemble system prompt (profile + SOUL-style persona) → inject context (step 6) → stream: text deltas → `TEXT_MESSAGE_*`, reasoning → `THINKING_*` (10Hz coalesced), tool-call deltas → `TOOL_CALL_*` → approval gate for dangerous tools (emit interrupt, await client response, timeout = reject) → execute tool → append result → continue until finish; emit `STATE_DELTA` when agent mutates its todo/plan state; persist every message/tool result to DB during the run; final `RUN_FINISHED` with usage → `hermes.context` custom event.
5. Tools (`agent/tools/`): `run_shell` (workspace-jailed cwd, dangerous), `read_file`/`write_file`/`list_dir` (jailed, write dangerous), `web_search`+`fetch_url`, `memory_save`/`memory_search`, `skill_save`/`skill_search`, `cron_create/list/delete`, `delegate_to_agent` (dispatch subtask to any configured provider, nested sub-run streaming), `a2ui_render` (validates payload against catalog schema, emits `a2ui.message` custom event). Registry declares JSON schema + `dangerous` flag per tool.
6. Vector pipeline: `vector/embeddings.ts` (batch 64, retry, configurable model), `vector/indexer.ts` (async queue embedding new messages/memory/skills), `vector/search.ts` (cosine HNSW top-k with recency/importance re-ranking). `agent/context.ts` composes: top-k memory + top-k matched skills + recent transcript window under a token budget.
7. MCP client (`mcp/`): `@modelcontextprotocol/sdk`, stdio + HTTP transports, discovery → namespaced tools merged into registry (approval-gated by default), resources into context builder, prompts as slash commands; `mcp_servers` config CRUD + connection health endpoint.
8. Skills loader (`skills/`): SKILL.md parser (frontmatter + body), folder + git sources, sync-to-DB with embeddings, `skill_save` learning-loop tool writing `learned/` SKILL.md folders.
9. Session title generation (first exchange → small LLM call → `hermes.title` event + DB update).
10. Auth (`auth/`): better-auth setup with Drizzle adapter, single-user bootstrap flow, login page in the app, route-guard middleware (REST + AG-UI + SSE), API tokens CRUD; compute layer (`compute/pool.ts` Bun Workers, `agent/tools/code.ts` sandboxed `run_code` subprocess tool).
11. Optional bridge (`bridge/hermes-python.ts`): env-gated adapter consuming existing hermes-webui SSE and re-emitting AG-UI events — best-effort mapping, documented limitations (implemented as an `AgentProvider`).
12. Tests: golden-file event stream test with fake LLM (scripted deltas incl. tool call + approval), cancellation test, `agui-remote` provider relay test (mock AG-UI endpoint), MCP tool-bridge test (mock MCP server), SKILL.md parser test, auth guard test (401 on unauthenticated AG-UI/REST), `run_code` sandbox limits test, context builder token-budget test, vector search ranking sanity.

AC: `curl -N POST /agui` against a real endpoint streams a complete multi-tool run; approval round-trip works via test harness; memory saved in one session is recalled in the next.

### Phase 4 — Chat core + AG-UI client (frontend)
1. `lib/agui/client.ts`: wraps `@ag-ui/client` `HttpAgent`; one live run per session; reconnect/recovery via `MESSAGES_SNAPSHOT`; dispatcher maps every event type to store actions (exhaustive on the event union).
2. Chat store: message tree per session, streaming buffers, rAF-batched token flush, tool-call map keyed by toolCallId, run status.
3. Composer: auto-grow textarea, Enter/Shift+Enter, slash-command autocomplete (registry: `/new`, `/clear`, `/model`, `/skill`, `/memory`, `/cron`, `/theme`, extensible), file attachment (uploads to `/api/workspace`), disabled-while-running with Stop button.
4. Message rendering: `MessageList` virtualized; `StreamingMarkdown` (react-markdown + remark-gfm, KaTeX inline, mermaid lazy, Shiki worker for fenced code with copy button + language badge); `ThinkingBlock` collapsible with duration; `ToolCallCard` states pending→streaming-args→executing→done/error, result rendered as code/diff/JSON-tree/plain; `ApprovalCard` Approve/Reject/Always-allow-this-session wired to the interrupt response; `RunProgress` with step chips + cancel; `ErrorBanner` with retry-run.
5. Shared state: `AgentStatePanel` in right panel rendering agent todos/plan/context from `agentState` store (JSON Patch applied via a tiny patch util); inline editing produces patched state included in the next `RunAgentInput.state`; predictive apply + snapshot reconcile.
6. Frontend tools registry: `open_file_preview`, `switch_panel`, `render_chart` (lightweight SVG sparkline/bar), `set_theme` — declared in run input, executed by dispatcher, results returned.
7. Session recovery: on mount, load messages via REST, resubscribe if a run is live (server exposes `GET /api/sessions/:id/live`).
8. Tests: dispatcher unit tests per event type; store streaming batch test; ApprovalCard interaction test.

AC: manual checklist — send, stream, think, tool card, approve, cancel, reload-mid-run recovery, state panel edit round-trip; 10k-message synthetic session scrolls at 60fps.

### Phase 5 — A2UI generative UI
1. Verify current npm package names/versions for the A2UI React renderer + web core (v0.9 line); pin exact versions. Fallback documented: wrap the Lit renderer in a React island if the React package lags.
2. `lib/a2ui/processor.ts`: instantiate MessageProcessor per surface; dispatcher routes `a2ui.message` custom events (JSONL) into it; surfaces anchored to their transcript position via `A2UISurface` component; progressive render with skeleton while incomplete.
3. Map standard catalog → design-system components (Text, Image, Button, TextField, Select, Radio, Checkbox, DateTime, Slider, List, virtualized Table, Card, Tabs, Divider, ProgressBar, Video/Audio) with Primer styling; unknown component → graceful placeholder card.
4. Custom Hermes widgets registered into the catalog with zod prop schemas from `packages/shared/a2ui-catalog.ts`: `hermes:SkillCard`, `hermes:MemoryEntryEditor`, `hermes:CronSchedulePicker`, `hermes:FileDiff`.
5. Actions: user interaction → `action` message → sent as tool/`actionResponse` back through the live AG-UI run (or spawns a new run if idle); loading/disabled states on the surface while awaiting.
6. Server side: `a2ui_render` tool + prompt guidance so the agent knows the catalog; validation rejects malformed payloads with a useful error back to the agent.
7. Demo scenarios (manual + scripted): agent renders a cron-setup form → user submits → cron job created; agent renders a memory table → user deletes a row; skill card gallery.

AC: all three demo scenarios pass end-to-end with round-trips.

### Phase 6 — Panels (feature parity)
1. Sessions: grouped collapsible list (by group/date), pin/archive, rename (inline + auto-title), delete with confirm, search box combining FTS (`/api/search`) + semantic results with match preview, project/profile picker per session.
2. Workspace: file tree (lazy-loaded dirs), file preview (Shiki, images, markdown render), upload/download, basic edit-and-save, git status badge if workspace is a repo (server shells `git status --porcelain`).
3. Skills: list with usage/success stats and source badges (builtin/user/git/learned), markdown editor (body_md), semantic search, git-repo source management + sync button, "learned" skills highlighted, delete/export.
4. MCP panel (in Settings): add/edit/enable MCP servers (stdio command or HTTP URL, env/headers), connection status, discovered tool list with per-tool whitelist toggle, test-connection button.
5. Memory: browser with kind filter (semantic/episodic/preference), importance sort, edit/delete, semantic search, "what does the agent know about X" query box.
6. Cron: job list with next/last run, croner-validated schedule input (with human-readable preview), run-now, run history per job (linking to result session), enable/disable.
7. Profiles: CRUD, system-prompt editor, model + temperature + provider (native / AG-UI framework endpoint), set-default; wired into composer model indicator.
8. Settings: LLM endpoint/key (masked), embeddings model, workspace root, approval whitelist management, theme, data export (JSON dump of sessions/memory/skills).
9. All via TanStack Query + IndexedDB persister; optimistic mutations with rollback toasts.

AC: feature-parity checklist against upstream hermes-webui README feature list — every item checked or consciously descoped with a note.

### Phase 7 — Polish + hardening
1. Command palette (`cmdk`, Ctrl+K): navigate sessions/panels, run slash commands, theme switch, "new session with profile…".
2. Keyboard map: Ctrl+B sidebar, Ctrl+Alt+B right panel, Ctrl+N new session, Esc cancel run, arrows in autocomplete; discoverable via palette "Keyboard shortcuts" entry.
3. Mobile: rail collapses to bottom nav, sidebar becomes drawer, composer sticky-bottom with safe-area padding.
4. Themes: dark (default), dim, light — all from Primer token sets; per-theme Shiki theme swap.
5. Empty/error/loading states for every panel; global error boundary with copy-diagnostics button.
6. License audit: review full dependency tree (`bun pm ls`), assert every package is MIT/Apache-2.0/PostgreSQL/ISC/BSD; document in `LICENSES.md`.
7. README: quick start, env reference, backup/restore, architecture diagram, parity checklist; CONTRIBUTING notes.
8. Final pass: `bun test` all green, Lighthouse ≥ 90 on a populated session, Windows + Docker cold-start walkthrough from a clean clone.

AC: parity checklist signed off; clean-clone-to-running < 5 minutes following README.

## 13. Risks and mitigations

- A2UI is pre-1.0 (v0.9 current, v1.0 RC) — pin versions; isolate behind `lib/a2ui/` so spec bumps touch one module.
- `@a2ui/react` package naming/versions may differ at install time — verify on npm during Phase 5; fall back to Lit renderer wrapped in React if needed (still permissive).
- Bun-on-Windows edge cases — CI-check `bun test` on Windows early (Phase 1); Node fallback possible since no Bun-only APIs are used outside `Bun.serve`/`Bun.sql` (both have shims).
- Hermes Python bridge event mapping unknowns — treat bridge as optional adapter; native runtime is the primary path.

## 14. Deliverables

- `hermes-ui` Bun monorepo: `app/` React frontend, `server/` Bun AG-UI orchestration server, `packages/shared`, compose file, scripts.
- Working end-to-end: browser chat ↔ AG-UI ↔ Hermes agent runtime (or any plugged framework) ↔ Postgres/pgvector, with A2UI generative surfaces.
- README (setup: `bun install`, `bun run db:up`, `bun run migrate`, `bun run dev`; backup/restore; env reference) + feature-parity checklist.
