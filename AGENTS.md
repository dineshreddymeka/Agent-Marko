# AGENTS.md

## Cursor Cloud specific instructions

Hermes UI is a Bun monorepo: `app/` (React 19 + Vite, port **5173**), `server/` (Bun HTTP + agent runtime, port **3001**), and `packages/shared/`. Standard commands live in `README.md` and root `package.json` scripts — use those. Notes below are the non-obvious bits.

### Services & how to run them
- **Postgres + pgvector** runs in Docker. The Docker daemon is NOT auto-started on this VM — start it once per session (in a background tmux session) and use `sudo docker`:
  - `sudo dockerd > /tmp/dockerd.log 2>&1 &` (daemon.json is preconfigured for `fuse-overlayfs` with the containerd snapshotter disabled, which is required for Docker 29 in this VM).
  - Start DB: `HERMES_DATA_DIR=/home/ubuntu/hermes-data bun run db:up` (compose maps host port **5433** → container 5432). `HERMES_DATA_DIR` must be set to this Linux path — the compose default is a Windows path (`C:/hermes-data`).
  - Apply schema after the DB is up: `bun run migrate`.
- **Dev servers** (both app + server): `bun run dev`. Health check: `curl http://127.0.0.1:3001/api/health` should return `{"ok":true,...,"db":true}`.
- `bun` is installed at `~/.bun/bin` (already on PATH via `~/.bashrc`).

### Environment / config
- `.env` (gitignored) is required and already created for this VM with a Linux `HERMES_DATA_DIR` (`/home/ubuntu/hermes-data`), a generated `BETTER_AUTH_SECRET`, and `HERMES_MOCK_LLM=1` + `LLM_API_KEY=mock` so the agent runs without a real LLM key. Set a real `LLM_API_KEY` (and unset the mock flags) to use a live OpenAI-compatible provider.
- Keep the Postgres data dir OUTSIDE the repo. If `HERMES_DATA_DIR` points inside `/workspace`, Docker writes root-owned files there and `eslint`/`tsc` fail with `EACCES` while scanning them.
- In localhost mode (`HOST=127.0.0.1`, `ALLOW_SIGNUP=false`) auth is bypassed, so no login is needed for local dev/testing.
- **Agent LLM / lm-bridge:** `tools/lm-bridge` is **development-only** text-chat degradation — it strips `tools` and cannot run MCP/A2UI/Cowork. Full Cursor-like agent behavior needs a tool-capable OpenAI-compatible endpoint.
  - `HERMES_AGENT_LLM_URL` — preferred tool-capable base URL for `/agui` (tried first).
  - `LLM_BASE_URL` — used when agent URL unset; if it points at `:3456` (lm-bridge), runtime falls back to bridge only when the agent circuit is open / URL unset (tools unavailable; UI gets `hermes.capabilities.degraded`).
  - `HERMES_EMBEDDINGS_URL` — optional dedicated embeddings base (defaults to agent URL, never prefers the chat-only bridge).
  - `HERMES_ROUTING=capabilities|legacy` — operator rollback; `legacy` restores regex `selectLlmTools` subsetting + pre-LLM interceptors. Default is `capabilities` (LLM chooses tools).
  - `HERMES_AGENT_LLM_TIMEOUT_MS` — bounded probe timeout before recording an agent-endpoint failure (default 5000).
  - `HERMES_LM_BRIDGE=0|1` — optional auto-start of lm-bridge from `scripts/dev.ts` for local text chat only.
  - Manifest: `GET /api/capabilities`; warm MCP+manifest: `POST /api/capabilities/warm`. Debug: `GET /api/debug/health` includes `capabilities` + `agentLlm`.

### Lint / test / build
- Lint: `bun run lint` (warnings are expected; exit 0).
- Unit tests: `bun run test`. DB integration tests are skipped unless `HERMES_INTEGRATION_TEST=1` and `DATABASE_URL` are set, e.g. `DATABASE_URL=postgres://hermes:hermes@localhost:5433/hermes HERMES_INTEGRATION_TEST=1 bun test server/test/db.integration.test.ts`.
- E2E: reuse the already-running dev server with `PLAYWRIGHT_SKIP_WEBSERVER=1 bun run test:e2e` (otherwise Playwright tries to bind 5173 itself).
- Build: `bun run build`.

### Skills
- `SKILLS_DIR` defaults to `./skills` resolved from the **server** process cwd — and the dev launcher runs the server with cwd `server/`, so skills actually live in **`server/skills/<name>/SKILL.md`** (not repo-root `skills/`).
- A `SKILL.md` needs frontmatter with `name`, `description`, and a `triggers` JSON array, then a markdown body. Reload without restarting via `POST /api/skills/sync` (or on server boot). `triggers` is stored in the DB but intentionally not returned by `GET /api/skills`.
- Existing skills: `generative-ui` (build A2UI surfaces via the `a2ui_render` tool over AG-UI) and `copilotkit` (CopilotKit frontend stack). Skill embeddings fail with the mock key (see 401 note below) — harmless; the skill still loads.

### Background cleanup worker
- `server/src/cleanup/worker.ts` starts on boot (when `CLEANUP_ENABLED=true`) alongside the cron scheduler and periodically prunes old `run_events`, old archived sessions, stale in-memory run-buffer entries, and sandbox temp files. Tunable via `CLEANUP_*` env vars; status is exposed at `GET /api/debug/health` under `cleanup`.
- `bun run clean` (`scripts/cleanup.ts`) resets local build/runtime state (build artifacts, temp dirs, sandbox files). Add `--db`/`--all` to also `TRUNCATE` app tables. It never touches the Postgres data volume or `.env`.

### Troubleshooting
- **Blank/white Vite screen** (app HTML loads but nothing renders, no console errors): usually a stale Vite dep pre-bundle cache after a dependency change or a long-running dev server. Fix: stop dev, `rm -rf app/node_modules/.vite`, then `bun run dev` again and hard-reload the browser.
- **`Embeddings failed (401) ... Incorrect API key provided: mock`** in server logs is expected when `LLM_API_KEY=mock`/`HERMES_MOCK_LLM=1`. Vector/embedding features are disabled but everything else works; set a real `LLM_API_KEY` to enable them.
- **Postgres `too many clients` / `53300`**: `bun --hot` leaks a SQL pool on each server-file reload. Restart the Postgres container (`docker compose restart postgres`) and the dev server to clear it.

### Known pre-existing product bug (not an environment issue)
- The agent chat **does not render in the browser UI** when the response includes reasoning/thinking deltas (this includes every mock-LLM scenario). The server (`@ag-ui/core@0.0.39`) emits `THINKING_TEXT_MESSAGE_START` without a preceding `THINKING_START`, which the newer frontend `@ag-ui/client@0.0.57` rejects with: `Cannot send 'THINKING_TEXT_MESSAGE_START' event: A thinking step is not in progress`. The run still completes server-side. Verify agent behavior via `curl -N POST /agui` (SSE) or the `verify:phase3`/`verify:offline`/`verify:a2ui` scripts, not the browser chat, until the AG-UI package versions are aligned.
