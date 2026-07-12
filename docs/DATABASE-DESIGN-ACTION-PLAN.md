# Database Design Alignment Action Plan

Author: Dinesh Reddy Meka  
Companion reference: `docs/DATABASE-DESIGN.md`

This document is the implementation plan for aligning the current Open Jarvis
database system with the design reference. It is intentionally detailed so a
separate implementation subagent can execute the work without needing prior chat
context.

**Verification status (2026-07-11):** Subagent V audited deliverables against
Section 13 / Section 11 — **PASS**. Report: `docs/DATABASE-DESIGN-VERIFICATION.md`.
Design reference Section 5 status updated in `docs/DATABASE-DESIGN.md`.

**F8 insert contract (2026-07-12):** **Completed** — `0009_insert_contract.sql`,
docs §1.5 matrix, cowork begin/finish + JSON restore. See
`docs/DATABASE-DESIGN.md` §1.5 / §5 F8.

---

## 1. Goal

Bring the implemented Postgres database closer to the integrity and operational
model described in `docs/DATABASE-DESIGN.md`, while avoiding breakage from SQL
sketches in the design doc that do not exactly match current runtime behavior.

The target outcome is:

- A safer migration runner.
- A new `0006` migration for integrity fixes.
- Tests that prove the implemented schema matches the intended constraints.
- Cleanup logic for denormalized cron bindings.
- Retention/pruning for append-only event logs.
- A clear path toward using a non-superuser application database role.

This is not a rewrite of the database. The existing schema shape is mostly
correct. The work is hardening, cleanup, and consistency.

---

## 2. Current System Snapshot

### 2.1 Database engine and migrations

- Engine: Postgres 17 with pgvector.
- Migrations are plain SQL under `server/migrations/*.sql`.
- Applied migration names are stored in `_hermes_migrations`.
- Migration runner: `server/src/db/migrate.ts`.
- Current migration files:
  - `server/migrations/0001_init.sql`
  - `server/migrations/0002_perf_indexes.sql`
  - `server/migrations/0003_api_tokens.sql`
  - `server/migrations/0004_mcp_connections.sql`
  - `server/migrations/0005_cron_workflow.sql`
  - `server/migrations/0006_integrity_fixes.sql` (**shipped**)
  - `server/migrations/0007_skills_sync.sql` (**shipped**)
  - `server/migrations/0008_jarvis_indexer.sql` (**shipped**)
  - `server/migrations/0009_insert_contract.sql` (**shipped** — F8)

### 2.2 Schema mirror

`server/src/db/schema.ts` mirrors the schema for Drizzle usage, but SQL
migrations are the DDL source of truth. Keep that rule.

Important note: `messages.search` exists in SQL as a generated `tsvector`, but
it is not represented in `schema.ts`. That is acceptable if code never writes it.

### 2.3 Tables currently implemented

The current database already implements the twelve application tables listed in
`docs/DATABASE-DESIGN.md`:

| Table | Exists | Main files |
| --- | --- | --- |
| `sessions` | Yes | `0001_init.sql`, `schema.ts`, `repositories/sessions.ts` |
| `messages` | Yes | `0001_init.sql`, `schema.ts`, `repositories/messages.ts` |
| `memory` | Yes | `0001_init.sql`, `schema.ts`, `repositories/memory.ts` |
| `skills` | Yes | `0001_init.sql`, `schema.ts`, `repositories/skills.ts` |
| `mcp_servers` | Yes | `0001_init.sql`, `0004_mcp_connections.sql`, `schema.ts`, `repositories/mcp_servers.ts` |
| `mcp_connection_events` | Yes | `0004_mcp_connections.sql`, `schema.ts`, `repositories/mcp_servers.ts` |
| `cron_jobs` | Yes | `0001_init.sql`, `0005_cron_workflow.sql`, `schema.ts`, `repositories/cron.ts` |
| `cron_runs` | Yes | `0001_init.sql`, `0005_cron_workflow.sql`, `schema.ts`, `repositories/cron.ts` |
| `run_events` | Yes | `0001_init.sql`, `schema.ts`, `repositories/run_events.ts` |
| `profiles` | Yes | `0001_init.sql`, `schema.ts`, `repositories/profiles.ts` |
| `settings` | Yes | `0001_init.sql`, `schema.ts`, `repositories/settings.ts` |
| `api_tokens` | Yes | `0003_api_tokens.sql`, `schema.ts`, `repositories/api_tokens.ts` |

### 2.4 Important runtime behavior

The design doc has SQL sketches that must be reconciled with current code before
implementation.

Current cron run statuses:

- `running`: inserted by `cronRepo.createRun`.
- `completed`: written by `server/src/cron/scheduler.ts` on success.
- `failed`: written by `server/src/cron/scheduler.ts` on failure.

Therefore, do not apply the design doc's example
`CHECK (status IN ('running','success','error','cancelled'))` verbatim. It would
reject current valid writes.

Current integration tests assert these index names:

- `messages_embedding_hnsw`
- `run_events_run_seq_idx`

If those indexes are dropped or renamed, tests must be updated in the same
change.

---

## 3. Gap Map

### 3.1 F1 - Missing nullable foreign keys

Design intent: add `ON DELETE SET NULL` references for nullable logical links.

Current gap:

- `sessions.profile_id` has no FK to `profiles.id`.
- `cron_jobs.profile_id` has no FK to `profiles.id`.
- `memory.source_session` has no FK to `sessions.id`.
- `cron_runs.session_id` has no FK to `sessions.id`.
- `run_events.session_id` has no FK to `sessions.id`.

Why it matters:

- Deleting a profile or session can leave dangling UUIDs.
- UI/repositories may show stale references.
- Future joins or filters can become misleading.

Implementation direction:

- Pre-clean existing orphan references.
- Add nullable FKs with `ON DELETE SET NULL`.
- Keep `messages.run_id` FK-less because runs are represented by an event stream,
  not a parent table.

### 3.2 F2 - Migration runner is fragile

Current gap:

`server/src/db/migrate.ts` splits migration files on every semicolon:

```ts
const statements = contents.split(';')
```

This breaks if any future migration contains:

- `DO $$ ... ; ... $$`
- SQL functions
- Triggers
- String literals with semicolons
- Multi-statement transaction logic that must be atomic

It also records the ledger row after statements have already executed. A
mid-file failure can leave a partially applied migration that is not recorded in
`_hermes_migrations`.

Implementation direction:

- Fix the migration runner before adding complex migrations.
- Execute each migration file atomically with the ledger insert in the same
  transaction.
- If Bun.sql cannot execute a whole multi-statement batch safely inside a
  transaction, use a real SQL splitter that understands PostgreSQL dollar
  quoting. Do not keep naive `split(';')`.

### 3.3 F3 - `messages_embedding_hnsw` may be dead weight

Current gap:

The index `messages_embedding_hnsw` exists, and message embeddings may be queued,
but current search paths appear to use:

- full-text search for messages
- vector search for memory/skills

If no code vector-searches `messages.embedding`, this index adds write overhead
without read benefit.

Implementation direction:

- First verify with code search and tests.
- If truly unused, drop `messages_embedding_hnsw` in `0006`.
- Update `server/test/db.integration.test.ts` because it currently expects the
  index.
- Optionally stop queueing message embeddings where applicable. Do this only if
  message embeddings are not planned for near-term use.

Decision needed:

- Keep the index if message vector search is planned soon.
- Drop it if the current product only needs FTS for messages.

### 3.4 F4 - Event log integrity and retention

Current gap:

- `run_events(run_id, seq)` has a non-unique index.
- Replay order assumes uniqueness, but the DB does not enforce it.
- `run_events` and `mcp_connection_events` can grow without retention.

Implementation direction:

- Replace or supplement `run_events_run_seq_idx` with a unique constraint/index.
- Decide whether to preserve the existing index name for test compatibility.
- Add an application-side pruning job or admin maintenance function.

Important test impact:

`server/test/db.integration.test.ts` expects `run_events_run_seq_idx`. If the
unique index uses a new name like `run_events_run_seq_key`, update the test.

Recommended implementation:

- Prefer unique index name `run_events_run_seq_key` for clarity.
- Update tests to expect `run_events_run_seq_key`.

Alternative:

- Recreate `run_events_run_seq_idx` as a unique index with the same name.
- This minimizes test churn, but the name no longer communicates uniqueness.

### 3.5 F5 - App uses the bootstrap DB superuser

Current gap:

The compose/default setup uses `hermes` / `hermes`. The design doc notes this is
currently the bootstrap superuser. If app pools consume all connections, admin
access can also be locked out because reserved superuser slots are no longer
protected from application usage.

Implementation direction:

- Create a dedicated non-superuser `hermes_app` role.
- Grant only needed privileges.
- Point runtime `DATABASE_URL` to `hermes_app`.
- Keep migration/admin tasks on a more privileged URL if needed.
- Consider reducing local `HERMES_DB_POOL_MAX`.

This likely spans SQL, Docker/env documentation, and possibly scripts.

### 3.6 F6 - Constraint hygiene

Current gaps:

- `api_tokens_hash_idx` duplicates the unique index created by
  `token_hash TEXT NOT NULL UNIQUE`.
- Text enum-like columns lack CHECK constraints:
  - `messages.role`
  - `cron_runs.status`
  - `mcp_servers.transport`
- Identity columns lack uniqueness:
  - `profiles.name`
  - `cron_jobs.name`
- `profiles` has no timestamps.
- `cron_jobs` has `updated_at` but no `created_at`.

Implementation direction:

- Drop duplicate `api_tokens_hash_idx`.
- Add CHECK constraints after verifying all actual runtime values.
- Add unique constraints only after checking existing duplicates.
- Add timestamp columns with defaults.

Do not guess enum values. Verify against shared types and runtime writers.

Known actual values:

| Column | Current values to allow |
| --- | --- |
| `messages.role` | likely `user`, `assistant`, `system`, `tool` |
| `cron_runs.status` | `running`, `completed`, `failed` |
| `mcp_servers.transport` | `stdio`, `http` based on current REST validation |

If there are other values in tests or seed data, include them or normalize them
before adding constraints.

### 3.7 F7 - Stale cron binding cleanup

Current gap:

`cron_jobs.mcp_server_ids` and `cron_jobs.skill_ids` are denormalized `uuid[]`
columns. PostgreSQL cannot enforce FKs on elements inside these arrays.

When an MCP server or skill is deleted, jobs can keep stale UUIDs.

Implementation direction:

- On MCP server delete:
  - remove deleted ID from `cron_jobs.mcp_server_ids`
  - update `workflow.mcpServerIds` if present
  - update `updated_at`
- On skill delete:
  - remove deleted ID from `cron_jobs.skill_ids`
  - update `workflow.skillIds` if present
  - update `updated_at`

This is code, not just SQL.

---

## 4. Implementation Principles

Follow these rules while executing the plan:

1. SQL migrations remain the source of truth for DDL.
2. Keep `schema.ts` aligned with the resulting schema but do not rely on it to
   create tables.
3. Use typed columns for fields that are filtered, sorted, joined, constrained,
   or indexed.
4. Use JSONB only for flexible payloads, caches, and pass-through data.
5. Prefer preflight cleanup over failed migrations.
6. Do not add constraints until existing data is known to satisfy them.
7. Do not apply design-doc SQL sketches verbatim when runtime code says
   otherwise.
8. Pair migration changes with tests in the same implementation branch.
9. Keep migrations idempotent where practical, but do not hide unsafe duplicate
   data under `IF NOT EXISTS`.
10. Avoid destructive changes unless the benefit is clear and tests are updated.

---

## 5. Phased Action Plan

### Phase 0 - Confirm baseline

Purpose: make sure the implementer is working from the actual current state.

Actions:

1. Run a working tree status check.
2. Confirm migration files present:
   - `0001_init.sql`
   - `0002_perf_indexes.sql`
   - `0003_api_tokens.sql`
   - `0004_mcp_connections.sql`
   - `0005_cron_workflow.sql`
3. Confirm no `0006_integrity_fixes.sql` exists yet.
4. Run tests that do not require Postgres.
5. If integration DB is available, run DB integration tests before changes.

Acceptance criteria:

- Baseline behavior is known.
- Any pre-existing failures are recorded and not confused with new failures.

### Phase 1 - Harden migration runner

Purpose: make future migrations safe and atomic.

Primary file:

- `server/src/db/migrate.ts`

Secondary files:

- `server/test/migrate.test.ts`

Actions:

1. Replace naive semicolon splitting with one of:
   - a transactional whole-file executor if supported by the driver, or
   - a PostgreSQL-aware SQL splitter.
2. Ensure the migration file and ledger insert happen in one transaction.
3. If a migration fails, no partial ledger row should be written.
4. Keep `discoverMigrationFiles` behavior unchanged.
5. Update tests to cover:
   - normal multi-statement migration
   - semicolon inside a string literal
   - dollar-quoted block, if supported by the new runner path
   - failed migration does not create ledger entry

Important constraint:

If whole-file execution cannot handle multiple statements through Bun.sql, do
not fake safety. Use a real parser/splitter or intentionally constrain `0006`
to avoid dollar blocks while documenting the limitation.

Acceptance criteria:

- Migration runner handles future migrations safely.
- Existing migrations still apply in filename order.
- Tests prove failure atomicity or clearly document the limitation.

### Phase 2 - Add database preflight checks

Purpose: detect data that would block constraints before applying `0006`.

Create either:

- a script under `scripts/db-preflight-integrity.ts`, or
- integration test helpers in `server/test`.

Recommended script:

- `scripts/db-preflight-integrity.ts`

The script should run read-only checks and print actionable output.

Preflight queries:

```sql
-- sessions.profile_id orphan check
SELECT s.id, s.profile_id
FROM sessions s
LEFT JOIN profiles p ON p.id = s.profile_id
WHERE s.profile_id IS NOT NULL AND p.id IS NULL;

-- cron_jobs.profile_id orphan check
SELECT c.id, c.profile_id
FROM cron_jobs c
LEFT JOIN profiles p ON p.id = c.profile_id
WHERE c.profile_id IS NOT NULL AND p.id IS NULL;

-- memory.source_session orphan check
SELECT m.id, m.source_session
FROM memory m
LEFT JOIN sessions s ON s.id = m.source_session
WHERE m.source_session IS NOT NULL AND s.id IS NULL;

-- cron_runs.session_id orphan check
SELECT cr.id, cr.session_id
FROM cron_runs cr
LEFT JOIN sessions s ON s.id = cr.session_id
WHERE cr.session_id IS NOT NULL AND s.id IS NULL;

-- run_events.session_id orphan check
SELECT re.id, re.session_id
FROM run_events re
LEFT JOIN sessions s ON s.id = re.session_id
WHERE re.session_id IS NOT NULL AND s.id IS NULL;

-- duplicate profiles.name
SELECT name, count(*)
FROM profiles
GROUP BY name
HAVING count(*) > 1;

-- duplicate cron_jobs.name
SELECT name, count(*)
FROM cron_jobs
GROUP BY name
HAVING count(*) > 1;

-- invalid message roles
SELECT role, count(*)
FROM messages
GROUP BY role
HAVING role NOT IN ('user', 'assistant', 'system', 'tool');

-- invalid cron statuses based on current implementation
SELECT status, count(*)
FROM cron_runs
GROUP BY status
HAVING status NOT IN ('running', 'completed', 'failed');

-- invalid MCP transports based on current REST validation
SELECT transport, count(*)
FROM mcp_servers
GROUP BY transport
HAVING transport NOT IN ('stdio', 'http');

-- duplicate run event sequence values
SELECT run_id, seq, count(*)
FROM run_events
GROUP BY run_id, seq
HAVING count(*) > 1;

-- stale cron MCP binding array elements
SELECT j.id, x.server_id
FROM cron_jobs j
CROSS JOIN LATERAL unnest(j.mcp_server_ids) AS x(server_id)
LEFT JOIN mcp_servers s ON s.id = x.server_id
WHERE s.id IS NULL;

-- stale cron skill binding array elements
SELECT j.id, x.skill_id
FROM cron_jobs j
CROSS JOIN LATERAL unnest(j.skill_ids) AS x(skill_id)
LEFT JOIN skills s ON s.id = x.skill_id
WHERE s.id IS NULL;
```

Acceptance criteria:

- Preflight tells the implementer whether `0006` is safe to apply.
- Any cleanup needed is explicit.

### Phase 3 - Create `0006_integrity_fixes.sql`

Purpose: apply the safe subset of schema hardening.

Primary file:

- `server/migrations/0006_integrity_fixes.sql`

Potential SQL outline:

```sql
-- Open Jarvis - integrity fixes
-- Depends on 0001-0005.

-- 1. Pre-clean nullable references.
UPDATE sessions s
SET profile_id = NULL
WHERE profile_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM profiles p WHERE p.id = s.profile_id);

UPDATE cron_jobs c
SET profile_id = NULL
WHERE profile_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM profiles p WHERE p.id = c.profile_id);

UPDATE memory m
SET source_session = NULL
WHERE source_session IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM sessions s WHERE s.id = m.source_session);

UPDATE cron_runs cr
SET session_id = NULL
WHERE session_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM sessions s WHERE s.id = cr.session_id);

UPDATE run_events re
SET session_id = NULL
WHERE session_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM sessions s WHERE s.id = re.session_id);

-- 2. Add nullable foreign keys.
-- PostgreSQL has no ADD CONSTRAINT IF NOT EXISTS. If migration runner cannot
-- handle DO $$ blocks yet, use plain ALTER TABLE in an append-only migration.
ALTER TABLE sessions
  ADD CONSTRAINT sessions_profile_fk
  FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE SET NULL;

ALTER TABLE cron_jobs
  ADD CONSTRAINT cron_jobs_profile_fk
  FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE SET NULL;

ALTER TABLE memory
  ADD CONSTRAINT memory_source_session_fk
  FOREIGN KEY (source_session) REFERENCES sessions(id) ON DELETE SET NULL;

ALTER TABLE cron_runs
  ADD CONSTRAINT cron_runs_session_fk
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE SET NULL;

ALTER TABLE run_events
  ADD CONSTRAINT run_events_session_fk
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE SET NULL;

-- 3. Add timestamps where missing.
ALTER TABLE cron_jobs
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- 4. Drop duplicate index.
DROP INDEX IF EXISTS api_tokens_hash_idx;

-- 5. Enforce known enum-like values.
ALTER TABLE messages
  ADD CONSTRAINT messages_role_check
  CHECK (role IN ('user', 'assistant', 'system', 'tool'));

ALTER TABLE cron_runs
  ADD CONSTRAINT cron_runs_status_check
  CHECK (status IN ('running', 'completed', 'failed'));

ALTER TABLE mcp_servers
  ADD CONSTRAINT mcp_servers_transport_check
  CHECK (transport IN ('stdio', 'http'));

-- 6. Enforce event replay uniqueness.
DROP INDEX IF EXISTS run_events_run_seq_idx;
CREATE UNIQUE INDEX run_events_run_seq_key ON run_events (run_id, seq);

-- 7. Optional: drop unused message vector index if decision is yes.
-- DROP INDEX IF EXISTS messages_embedding_hnsw;

ANALYZE sessions;
ANALYZE profiles;
ANALYZE messages;
ANALYZE memory;
ANALYZE mcp_servers;
ANALYZE cron_jobs;
ANALYZE cron_runs;
ANALYZE run_events;
```

Important:

- PostgreSQL does not support `ALTER TABLE ... ADD CONSTRAINT IF NOT EXISTS`.
- If migrations can be run only once in normal flow, plain `ADD CONSTRAINT` is
  acceptable.
- If repeated manual re-runs against a partially modified DB are required, either
  use `DO $$` guards after Phase 1 supports them or add a documented manual
  recovery process.

Unique constraints for `profiles.name` and `cron_jobs.name`:

- Only add these if preflight proves no duplicates or if a duplicate cleanup plan
  is implemented.
- Do not blindly add them in the first `0006` if current data may contain
  duplicates.

Recommendation:

- Defer `profiles.name UNIQUE` and `cron_jobs.name UNIQUE` to a follow-up
  `0007_identity_constraints.sql` unless the product clearly requires unique
  names now.

Acceptance criteria:

- Migration applies cleanly to a fresh database.
- Migration applies cleanly to an existing dev database with no invalid data.
- Constraints match current runtime values.

### Phase 4 - Update Drizzle schema mirror

Purpose: keep `schema.ts` descriptive mirror accurate.

Primary file:

- `server/src/db/schema.ts`

Actions:

1. Add `createdAt` to `cronJobs`.
2. Add `createdAt` and `updatedAt` to `profiles`.
3. If `messages_embedding_hnsw` is dropped, no `schema.ts` change is needed for
   the index because it is not declared there.
4. If `run_events_run_seq_key` is introduced, update the Drizzle index declaration
   if Drizzle supports unique index in the current import set.

Potential Drizzle changes:

```ts
import { uniqueIndex } from 'drizzle-orm/pg-core'
```

Then:

```ts
(t) => [uniqueIndex('run_events_run_seq_key').on(t.runId, t.seq)]
```

Acceptance criteria:

- TypeScript compile passes.
- Repository DTO mapping includes new timestamps only if API types require them.

### Phase 5 - Update repositories and delete cleanup

Purpose: keep denormalized cron binding arrays and JSON workflow in sync.

Primary files:

- `server/src/db/repositories/mcp_servers.ts`
- `server/src/db/repositories/skills.ts`
- `server/src/db/repositories/cron.ts`

Actions:

1. Add helper function in `cronRepo`:

```ts
async removeDeletedMcpServerBinding(serverId: string): Promise<void>
async removeDeletedSkillBinding(skillId: string): Promise<void>
```

2. Each helper should:
   - remove ID from the typed array column using `array_remove`
   - update the matching workflow JSON array if present
   - set `updated_at = NOW()`

3. Call the MCP cleanup helper after successful MCP server deletion.
4. Call the skill cleanup helper after successful skill deletion.

SQL shape for array cleanup:

```sql
UPDATE cron_jobs
SET mcp_server_ids = array_remove(mcp_server_ids, $1::uuid),
    updated_at = NOW()
WHERE mcp_server_ids @> ARRAY[$1::uuid];
```

JSONB cleanup is trickier. If `workflow` contains `mcpServerIds`, rebuild it
using JSONB functions or perform it in TypeScript by loading affected rows and
calling `cronRepo.updateJob`.

Recommendation:

- Use repository-level TypeScript for JSONB workflow cleanup to avoid complex
  SQL and keep it consistent with `coerceCronWorkflow`.
- Use SQL array filter first to find affected rows cheaply.

Acceptance criteria:

- Deleting an MCP server removes it from affected cron jobs.
- Deleting a skill removes it from affected cron jobs.
- Workflow JSON and array columns remain consistent.

### Phase 6 - Add retention/pruning

Purpose: prevent append-only audit tables from growing forever.

Candidate files:

- `server/src/db/repositories/run_events.ts`
- `server/src/db/repositories/mcp_servers.ts`
- `server/src/index.ts`
- `server/src/cron/scheduler.ts` or a new maintenance module

Actions:

1. Add repository methods:

```ts
runEventsRepo.pruneOlderThan(days: number)
mcpServersRepo.pruneConnectionEventsOlderThan(days: number)
```

2. Add config values:

```env
HERMES_EVENT_RETENTION_DAYS=30
HERMES_MCP_EVENT_RETENTION_DAYS=30
```

3. Run pruning:
   - at server startup, or
   - via an internal scheduled maintenance timer, or
   - via a script called by verification/ops.

Recommendation:

- Start with explicit script or startup pruning to keep scope small.
- Add UI controls later only if needed.

Acceptance criteria:

- Old `run_events` rows can be pruned safely.
- Old `mcp_connection_events` rows can be pruned safely.
- Recent events are preserved.

### Phase 7 - Non-superuser role hardening

Purpose: prevent app pools from consuming reserved superuser connections.

Files likely affected:

- `docker-compose.yml`
- `.env.example`
- `docs/DATABASE-DESIGN.md`
- maybe scripts under `scripts/`

Actions:

1. Decide whether app role creation belongs in:
   - a manual admin script
   - a Docker init script
   - a migration

2. Recommended: use a separate admin bootstrap script, not a normal app
   migration, because role management needs elevated privileges and is
   environment-specific.

Example SQL:

```sql
CREATE ROLE hermes_app LOGIN PASSWORD '<strong-password>' NOSUPERUSER;
GRANT CONNECT ON DATABASE hermes TO hermes_app;
GRANT USAGE ON SCHEMA public TO hermes_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO hermes_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO hermes_app;
```

3. Update runtime `DATABASE_URL` to use `hermes_app`.
4. Keep a migration/admin URL for schema migrations if needed.
5. Consider reducing dev `HERMES_DB_POOL_MAX` from 10 to 4 or 5.

Acceptance criteria:

- App can read/write normally as `hermes_app`.
- Admin `psql` access remains possible when app pools are busy.
- Documentation explains the two-role model.

---

## 6. Concrete File Change Checklist

### Must change

| File | Change |
| --- | --- |
| `server/src/db/migrate.ts` | Replace fragile semicolon splitting and make migration application atomic |
| `server/test/migrate.test.ts` | Add parser/transaction/failure tests |
| `server/migrations/0006_integrity_fixes.sql` | Add FKs, checks, index cleanup, timestamps |
| `server/src/db/schema.ts` | Mirror new timestamp columns and unique run event index |
| `server/test/db.integration.test.ts` | Update expected indexes/constraints after `0006` |

### Should change

| File | Change |
| --- | --- |
| `server/src/db/repositories/cron.ts` | Add binding cleanup helpers |
| `server/src/db/repositories/mcp_servers.ts` | Call cleanup on delete |
| `server/src/db/repositories/skills.ts` | Call cleanup on delete |
| `server/test/cron-repo.integration.test.ts` | Add cleanup tests and status constraint checks |
| `server/test/migrate.test.ts` | Assert discovery includes `0006` after added |

### Optional/follow-up

| File | Change |
| --- | --- |
| `scripts/db-preflight-integrity.ts` | Add preflight checker |
| `scripts/db-prune-events.ts` | Add manual prune command |
| `.env.example` | Document app role URL/pool guidance |
| `docker-compose.yml` | Add role/bootstrap setup if chosen |
| `docs/DATABASE-DESIGN.md` | Update status/action plan once implemented |

---

## 7. Test Plan

### 7.1 Unit tests

Run:

```bash
bun test server/test/migrate.test.ts
```

Add tests for:

- migration discovery order
- SQL containing semicolon inside string
- dollar-quoted block if supported
- failed migration rollback/ledger behavior

### 7.2 Integration tests

Run with integration DB enabled:

```bash
bun test server/test/db.integration.test.ts
bun test server/test/cron-repo.integration.test.ts
```

Add/adjust assertions:

- `_hermes_migrations` contains `0006_integrity_fixes.sql`
- FKs exist in `pg_constraint`
- CHECK constraints exist and accept current runtime values
- `cron_runs.status` accepts `running`, `completed`, `failed`
- invalid cron status is rejected
- `run_events(run_id, seq)` rejects duplicates
- duplicate `api_tokens_hash_idx` is gone
- expected indexes reflect the final decision on:
  - `messages_embedding_hnsw`
  - `run_events_run_seq_idx` vs `run_events_run_seq_key`

### 7.3 Repository behavior tests

Add tests for:

- deleting an MCP server removes it from `cron_jobs.mcp_server_ids`
- deleting a skill removes it from `cron_jobs.skill_ids`
- workflow JSON remains consistent after cleanup
- cron run lifecycle writes `running` -> `completed`
- cron failure writes `failed`

### 7.4 Manual smoke

1. Start Postgres.
2. Run migrations.
3. Start server.
4. Create profile.
5. Create session with profile.
6. Create cron job with workflow bindings.
7. Delete profile and confirm session/profile references are `NULL`.
8. Delete MCP/skill and confirm cron bindings are cleaned.
9. Trigger cron and confirm run status is `completed` or `failed`.

---

## 8. Rollback Plan

### Before applying `0006`

- Take a DB backup using existing backup script if available.
- Capture migration ledger.
- Run preflight checks and save output.

### If migration fails before ledger insert

- With the hardened runner, transaction should roll back.
- Fix SQL/data and rerun.

### If migration was partially applied by old runner

This is why Phase 1 must happen first. If it still occurs:

1. Inspect `pg_constraint`, `pg_indexes`, and `_hermes_migrations`.
2. Manually remove partially added constraints/indexes if safe.
3. Restore from backup if state is uncertain.

### If `0006` succeeds but app breaks

Likely causes:

- CHECK constraint excludes a runtime value.
- Unique index rejects duplicate run events.
- Tests/code still expect old index names.

Recovery:

- Prefer forward fix with `0007` if already applied in shared/dev DB.
- Only manually drop constraints in local dev if no shared data depends on them.

Example emergency SQL:

```sql
ALTER TABLE cron_runs DROP CONSTRAINT IF EXISTS cron_runs_status_check;
ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_role_check;
ALTER TABLE mcp_servers DROP CONSTRAINT IF EXISTS mcp_servers_transport_check;
DROP INDEX IF EXISTS run_events_run_seq_key;
CREATE INDEX IF NOT EXISTS run_events_run_seq_idx ON run_events (run_id, seq);
```

---

## 9. Risks and Mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Applying wrong cron status CHECK | Cron fails at runtime | Use `running/completed/failed`, add integration test |
| Migration runner remains fragile | Partial migrations | Complete Phase 1 before `0006` |
| Existing data violates constraints | Migration fails | Run preflight and cleanup first |
| Dropping message HNSW prematurely | Future vector search work blocked | Make explicit decision; recreate index if needed |
| Renaming index breaks tests | CI failure | Update `db.integration.test.ts` in same change |
| Unique run event index fails due duplicates | Migration fails | Preflight duplicate check first |
| Role hardening breaks migrations | App cannot migrate | Separate app URL and admin/migration URL |
| JSON workflow cleanup drifts from arrays | UI shows stale bindings | Test delete cleanup for both typed arrays and workflow JSON |

---

## 10. Decision Points Before Implementation

Ask or decide these before coding:

1. Should `messages_embedding_hnsw` be dropped now, or kept for planned message
   vector search?
2. Should `run_events` unique index use the new clear name
   `run_events_run_seq_key`, or preserve the old index name?
3. Are `profiles.name` and `cron_jobs.name` required to be unique in the product
   UX?
4. Should event pruning run at startup, via a script, or via scheduled internal
   maintenance?
5. Should `hermes_app` role creation be Docker init, a script, or manual docs?
6. Should migration runner support `DO $$` immediately, or should `0006` avoid
   SQL that requires it?

Recommended defaults:

- Keep `messages_embedding_hnsw` until a product decision says message vector
  search is out of scope.
- Use `run_events_run_seq_key` and update tests.
- Defer unique names until UX confirms uniqueness.
- Start pruning as a script or startup maintenance, not a UI feature.
- Create `hermes_app` through admin/bootstrap script, not app migration.
- Support `DO $$` eventually, but write `0006` without it if runner support is
  still uncertain.

---

## 11. Work Breakdown for Subagents

### Subagent A - Migration runner

Scope:

- `server/src/db/migrate.ts`
- `server/test/migrate.test.ts`

Deliverables:

- Atomic migration execution.
- Robust SQL handling or documented supported SQL subset.
- Tests for semicolons, ordering, and failure behavior.

Do not:

- Create `0006` in this subtask unless runner tests pass.

### Subagent B - Preflight + migration

Scope:

- `scripts/db-preflight-integrity.ts`
- `server/migrations/0006_integrity_fixes.sql`
- `server/test/db.integration.test.ts`
- `server/src/db/schema.ts`

Deliverables:

- Preflight checks.
- Safe `0006`.
- Schema mirror update.
- Integration tests for constraints/indexes.

Must remember:

- Cron status values are `running`, `completed`, `failed`.
- Do not apply `success/error/cancelled` CHECK.

### Subagent C - Repository cleanup

Scope:

- `server/src/db/repositories/cron.ts`
- `server/src/db/repositories/mcp_servers.ts`
- `server/src/db/repositories/skills.ts`
- relevant tests

Deliverables:

- Delete cleanup for MCP bindings.
- Delete cleanup for skill bindings.
- Tests proving typed arrays and workflow JSON stay in sync.

### Subagent D - Retention and ops

Scope:

- repository prune methods
- optional script
- config/docs

Deliverables:

- Event pruning logic.
- Tests around retention cutoffs.
- Docs for retention defaults.

### Subagent E - Role hardening

Scope:

- `.env.example`
- `docker-compose.yml` or bootstrap scripts
- docs

Deliverables:

- Non-superuser app-role plan/implementation.
- Clear separation between app DB URL and admin/migration URL if needed.

---

## 12. Suggested Final Implementation Order

1. Subagent A: migration runner hardening.
2. Subagent B: preflight script.
3. Run preflight against local DB.
4. Subagent B: create `0006` and update tests/schema mirror.
5. Run migration and DB integration tests.
6. Subagent C: cron binding cleanup on MCP/skill delete.
7. Subagent D: retention/prune.
8. Subagent E: non-superuser role hardening.
9. Update `docs/DATABASE-DESIGN.md` Section 5 to mark completed items.

---

## 13. Definition of Done

The database alignment work is done when:

- `0006_integrity_fixes.sql` exists and is tracked in migrations.
- Migration runner no longer has unsafe naive semicolon splitting.
- DB integration tests pass against a fresh migrated database.
- FKs exist for nullable logical references.
- Cron status constraint matches actual runtime statuses.
- `run_events(run_id, seq)` uniqueness is enforced.
- Duplicate token hash index is removed.
- Cron binding cleanup is covered by tests.
- Retention policy exists for append-only event tables.
- Documentation reflects what shipped and what remains deferred.

### Verification outcome (Subagent V, 2026-07-11)

| DoD item | Result |
| --- | --- |
| `0006` exists | PASS |
| Safe migration runner | PASS |
| Integration tests on fresh DB | Tests present; **not executed** in verifier env (skipped without Postgres) |
| Nullable FKs | PASS |
| Cron status CHECK | PASS (`running`/`completed`/`failed`) |
| Unique `(run_id, seq)` | PASS |
| Drop duplicate token hash index | PASS |
| Cron binding cleanup + tests | PASS (tests present) |
| Event retention | PASS |
| Docs shipped vs deferred | PASS — see `docs/DATABASE-DESIGN.md` §5 and `docs/DATABASE-DESIGN-VERIFICATION.md` |

**Still deferred (not DoD blockers):** drop `messages_embedding_hnsw`; name UNIQUEs;
auto-apply `hermes_app` in compose.

---

## 14. F8 — Insert contract (session_id + date + jsonb) — COMPLETED 2026-07-12

Goal: every table insert carries a **date**; session-scoped rows carry
**session_id**; global tables use **nullable** `session_id`; structured payloads
stay **jsonb**. Reuse `sessions` + `run_events` for cowork (no new tables).

### Deliverables

| Item | Status |
| --- | --- |
| `0009_insert_contract.sql` | **Done** |
| Drizzle `schema.ts` mirror | **Done** |
| `settings` created_at/updated_at + upsert bump | **Done** |
| Nullable `session_id` on global tables + FKs | **Done** |
| Cowork `beginCoworkAudit` / `finishCoworkAudit` | **Done** |
| List/detail restore from jsonb payloads | **Done** |
| Docs §1.5 matrix + COWORK shapes | **Done** |
| Unit tests (`insert-contract`, `cowork-restore`) | **Done** |

### Intentional exceptions

- `sessions` — row *is* the session (no `session_id` column).
- `memory.source_session` — historical name for the session FK (not renamed).
- `jarvis_index_chunks` / `jarvis_index_action_links` — inherit session via parent FK.
- `_hermes_migrations` — ledger only (`applied_at`).
- Global tables keep `session_id` NULL for truly global writes (no bootstrap session).

### Definition of done

- [x] Migration applied via existing hardened `migrate.ts`
- [x] Design doc insert-contract matrix + cowork shapes
- [x] Action plan marked complete
- [x] Focused unit tests; integration tests extended when Postgres available

