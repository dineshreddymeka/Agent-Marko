# ADR-002: Postgres 17 + pgvector with external data volume (Open Jarvis)

**Author:** Dinesh Reddy Meka

## Status

Accepted — **Postgres 17 only** (`pgvector/pgvector:0.8.5-pg17`) for Open Jarvis.

## Context

**Open Jarvis** needs persistent agent memory, semantic search, and session history in a relational DB with vector similarity. Data must survive repo re-clones. **Locked decision: Postgres 17 + pgvector 0.8.5** — not Postgres 18.

## Decision

Bind-mount `${HERMES_DATA_DIR}/postgres` (default `C:/hermes-data/postgres`) to **`/var/lib/postgresql/data`**. No named Docker volumes. App DB/user remain `hermes`.

## Ultra ops (local / desktop)

| Knob | Value | Notes |
|------|-------|-------|
| `shm_size` | 256mb | Required for `shared_buffers=256MB` |
| `shared_buffers` | 256MB | Desktop Docker |
| `work_mem` | 16MB | Per-sort/hash; modest with `max_connections=50` |
| `effective_cache_size` | 1GB | Planner hint |
| `maintenance_work_mem` | 128MB | Index builds / VACUUM |
| `random_page_cost` | 1.1 | SSD bind mount |
| `max_connections` | 50 | Headroom over Bun.sql pool (`HERMES_DB_POOL_MAX`, default 10) |

## Migrations & indexes

- Auto-discovered `server/migrations/*.sql` → `_hermes_migrations`
- `0001_init.sql`: DDL, pgvector, GIN FTS, HNSW embeddings
- `0002_perf_indexes.sql` (if present): IF NOT EXISTS btree helpers + ANALYZE

## Backup & restore

- `bun run db:backup` → `${HERMES_BACKUP_DIR}/hermes-*.sql`
- Retention: `HERMES_BACKUP_KEEP` (default **10**)
- `bun run db:restore` / `bun run db:restore:verify` — asserts Postgres **17**, vector extension, core tables

## Consequences

- Project delete/reclone never wipes DB (external bind mount)
- Stay on PG17 unless product owner explicitly changes SoT
