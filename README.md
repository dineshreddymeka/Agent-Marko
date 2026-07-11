# Hermes UI

Modern Hermes Agent WebUI — Bun monorepo with React 19 frontend and Bun server.

## Quick start

```bash
bun install
bun run dev
```

- Frontend: http://localhost:5173
- API health: http://127.0.0.1:3001/api/health

## Scripts

| Script | Description |
|--------|-------------|
| `bun run dev` | Start Vite app + Bun server concurrently |
| `bun run build` | Build app and server |
| `bun run test` | Run smoke tests across workspaces |
| `bun run lint` | ESLint |
| `bun run db:up` | Start Postgres + pgvector (Docker) |
| `bun run db:down` | Stop database |
| `bun run migrate` | Run DB migrations |
| `bun run verify:phase2` | Docker up, migrate, integration tests, health, backup |
| `bun run verify:phase3` | Mock LLM AG-UI stream + SSE smoke (no API key) |
| `bun run verify:phase3:llm` | Real LLM smoke (skips if no API key) |
| `bun run verify:offline` | Debug replay without Postgres (in-memory run buffer) |
| `bun run verify:a2ui` | A2UI demo scenarios (cron, memory, skills) |
| `bun run verify:lighthouse` | Lighthouse performance on built shell |
| `bun run verify:all` | All verifiers (skips Phase 2 if Docker daemon unavailable) |
| `bun run test:e2e` | Playwright smoke tests (starts dev server) |

CI runs on push/PR via `.github/workflows/ci.yml` (unit + mock AG-UI + Playwright + Postgres job).

Settings → **Debug** tab: replay recorded AG-UI runs through the UI dispatcher.

See [PLAN.md](./PLAN.md) for the full engineering plan.
