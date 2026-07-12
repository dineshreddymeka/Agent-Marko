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

### Lint / test / build
- Lint: `bun run lint` (warnings are expected; exit 0).
- Unit tests: `bun run test`. DB integration tests are skipped unless `HERMES_INTEGRATION_TEST=1` and `DATABASE_URL` are set, e.g. `DATABASE_URL=postgres://hermes:hermes@localhost:5433/hermes HERMES_INTEGRATION_TEST=1 bun test server/test/db.integration.test.ts`.
- E2E: reuse the already-running dev server with `PLAYWRIGHT_SKIP_WEBSERVER=1 bun run test:e2e` (otherwise Playwright tries to bind 5173 itself).
- Build: `bun run build`.

### Known pre-existing product bug (not an environment issue)
- The agent chat **does not render in the browser UI** when the response includes reasoning/thinking deltas (this includes every mock-LLM scenario). The server (`@ag-ui/core@0.0.39`) emits `THINKING_TEXT_MESSAGE_START` without a preceding `THINKING_START`, which the newer frontend `@ag-ui/client@0.0.57` rejects with: `Cannot send 'THINKING_TEXT_MESSAGE_START' event: A thinking step is not in progress`. The run still completes server-side. Verify agent behavior via `curl -N POST /agui` (SSE) or the `verify:phase3`/`verify:offline`/`verify:a2ui` scripts, not the browser chat, until the AG-UI package versions are aligned.
