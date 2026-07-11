# ADR-002: Postgres 17 + pgvector with external data volume

## Status

Accepted (amended 2026-07-11 — PG17 per org Artifactory policy)

## Context

Persistent agent memory, semantic search, and session history require a relational DB with vector similarity. Data must survive repo re-clones. **Org registry standardizes on Postgres 17**, not 18.

## Decision

**Postgres 17** with **pgvector 0.8.5** in Docker (`pgvector/pgvector:0.8.5-pg17`). Bind-mount `${HERMES_DATA_DIR}/postgres` (default `C:/hermes-data/postgres`) to **`/var/lib/postgresql/data`** — no named Docker volumes.

## Consequences

- Embeddings stored in-table with HNSW indexes
- Backups via `pg_dump` to `HERMES_BACKUP_DIR`
- PG17 uses the traditional data mount path (`/var/lib/postgresql/data`), not the PG18 parent-dir layout
