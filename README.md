# Agent-Marko

Modern Bun monorepo for the Hermes Agent WebUI — React 19 frontend, Bun AG-UI orchestration server, Postgres 18 + pgvector persistence, with first-class **AG-UI** and **A2UI** protocol support.

## Quick start

**Prerequisites:** [Bun](https://bun.sh) 1.2+, [Docker Desktop](https://www.docker.com/products/docker-desktop/) (for Postgres).

```powershell
# Clone and install
cd Agent-Marko
bun install

# Configure environment
copy .env.example .env

# Start database (data stored outside repo at C:\hermes-data\postgres)
bun run db:up
bun run migrate

# Run dev (Vite :5173 + server :3001)
bun run dev
```

Open http://localhost:5173 — the Vite dev server proxies `/api` and `/agui` to the Bun backend.

## Scripts

| Script | Description |
|--------|-------------|
| `bun run dev` | Start frontend + backend concurrently |
| `bun run build` | Production build (app + server) |
| `bun test` | Run all workspace tests |
| `bun run lint` | ESLint across the monorepo |
| `bun run db:up` | Start Postgres 18 + pgvector container |
| `bun run db:down` | Stop Postgres container |
| `bun run migrate` | Apply SQL migrations |
| `bun run db:backup` | Timestamped `pg_dump` to `HERMES_BACKUP_DIR` |
| `bun run db:restore` | Restore from a backup file |

## Environment

See `.env.example`. Key variables:

- `DATABASE_URL` — Postgres connection (default port **5433**)
- `HERMES_DATA_DIR` — bind mount root for PG data and logs (default `C:/hermes-data`)
- `LLM_BASE_URL` / `LLM_API_KEY` — OpenAI-compatible chat completions API
- `EMBEDDINGS_MODEL` / `EMBEDDING_DIMENSION` — vector search configuration
- `ALLOW_SIGNUP=false` — single-user mode; localhost dev bypass when unset auth
- `WORKSPACE_ROOT` — jailed file/shell tool workspace

## Architecture

```
┌─────────────┐   AG-UI SSE    ┌──────────────────┐   Bun.sql   ┌──────────────┐
│  React app  │ ◄────────────► │  Bun server      │ ◄──────────►│ Postgres 18  │
│  (Vite)     │   REST /api    │  agent runtime   │             │ + pgvector   │
└─────────────┘                └──────────────────┘             └──────────────┘
       │                               │
       │ A2UI surfaces                 │ MCP + SKILL.md + cron
       ▼                               ▼
  lib/a2ui/                      agent/tools/
```

- **`app/`** — React 19 + TanStack Router/Query, Zustand stores, Primer dark design tokens
- **`server/`** — `Bun.serve` AG-UI endpoint, native/agui-remote/hermes-python providers, vector pipeline
- **`packages/shared/`** — DTOs, custom AG-UI events, A2UI catalog schemas

See `PLAN.md` for the full engineering plan and `docs/PARITY.md` for upstream feature parity.

## Backup & restore

```powershell
bun run db:backup
# Creates C:\hermes-data\backups\hermes-YYYYMMDD-HHMMSS.sql

bun run db:restore -- path\to\backup.sql
```

## License

MIT. Dependency licenses documented in `LICENSES.md` (permissive-only policy: MIT / Apache-2.0 / PostgreSQL / ISC / BSD).
