# ADR-002: Postgres 18 + pgvector with external data volume

## Status

Accepted

## Context

Persistent agent memory, semantic search, and session history require a relational DB with vector similarity. Data must survive repo re-clones.

## Decision

**Postgres 18** with **pgvector 0.8.5** in Docker. Bind-mount `${HERMES_DATA_DIR}/postgres` (default `C:/hermes-data/postgres`) — no named Docker volumes.

## Consequences

- Embeddings stored in-table with HNSW indexes
- Backups via `pg_dump` to `HERMES_BACKUP_DIR`
- PG18 uses `/var/lib/postgresql` mount path (not `/var/lib/postgresql/data`)
