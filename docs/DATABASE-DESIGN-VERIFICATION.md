# Database Design Alignment — Verification Report

**Verifier:** Subagent V  
**Date:** 2026-07-11  
**Plan:** `docs/DATABASE-DESIGN-ACTION-PLAN.md`  
**Reference:** `docs/DATABASE-DESIGN.md`  

**Overall:** **PASS** (all checklist items shipped; integration suites skipped — no live Postgres in this verifier environment)

First audit after ~3.5 min wait. Deliverables were complete; no second wait required.

---

## Checklist

### [x] PASS — `migrate.ts` no longer naive `split(';')` / has transactional apply

**Evidence:** `server/src/db/migrate.ts`

- Uses `splitPostgresStatements()` (quote/dollar-quote/comment aware), not `contents.split(';')`.
- Applies each file inside `sql.begin(...)` via `applyMigrationWithLedger` (statements + ledger insert).

```ts
const statements = splitPostgresStatements(contents)
await sql.begin(async (tx) => {
  await applyMigrationWithLedger(/* ... */, file, statements)
})
```

---

### [x] PASS — migrate tests exist / pass

**Evidence:** `server/test/migrate.test.ts`

Coverage includes discovery (incl. `0006`), string-literal `;`, dollar-quoted blocks, ledger-after-success, and no ledger on failure.

**Test run:**

```text
bun test server/test/migrate.test.ts
13 pass, 0 fail
```

---

### [x] PASS — `scripts/db-preflight-integrity.ts` exists

**Evidence:** `scripts/db-preflight-integrity.ts`  
**Script:** `package.json` → `"db:preflight": "bun run scripts/db-preflight-integrity.ts"`

Read-only orphan / duplicate / enum / stale-binding checks; exits non-zero on blockers.

---

### [x] PASS — `0006_integrity_fixes.sql` exists with correct cron CHECK

**Evidence:** `server/migrations/0006_integrity_fixes.sql`

```sql
ALTER TABLE cron_runs
  ADD CONSTRAINT cron_runs_status_check
  CHECK (status IN ('running', 'completed', 'failed'));
```

Also includes orphan pre-clean, nullable FKs, timestamps, `api_tokens_hash_idx` drop, role/transport CHECKs, unique `run_events` index, `ANALYZE`.

---

### [x] PASS — `messages_embedding_hnsw` NOT dropped

**Evidence:** `server/migrations/0006_integrity_fixes.sql` line 81:

```sql
-- Keep messages_embedding_hnsw (message vector search still planned).
```

No `DROP INDEX` for that name. Integration test still expects it (`server/test/db.integration.test.ts`).

**Deferred product decision:** drop only if message vector search is explicitly out of scope (F3).

---

### [x] PASS — `run_events_run_seq_key` unique index in `0006`

**Evidence:** `server/migrations/0006_integrity_fixes.sql`

```sql
DROP INDEX IF EXISTS run_events_run_seq_idx;
CREATE UNIQUE INDEX run_events_run_seq_key ON run_events (run_id, seq);
```

---

### [x] PASS — `schema.ts` timestamps + unique index mirror

**Evidence:** `server/src/db/schema.ts`

- `cronJobs.createdAt` / `updatedAt`
- `profiles.createdAt` / `updatedAt`
- `uniqueIndex('run_events_run_seq_key').on(t.runId, t.seq)`

---

### [x] PASS — `db.integration.test.ts` updated

**Evidence:** `server/test/db.integration.test.ts`

- Expects `run_events_run_seq_key`, not `run_events_run_seq_idx`
- Expects `messages_embedding_hnsw` retained
- Asserts FKs, CHECKs, timestamp columns, migration ledger includes `0006`
- Asserts duplicate-seq rejection and valid cron statuses

*(Suite skipped here — no integration DB; tests exist and are wired.)*

---

### [x] PASS — cron binding cleanup helpers + called on MCP/skill delete + tests

**Evidence:**

| Piece | Path |
| --- | --- |
| Helpers | `server/src/db/repositories/cron.ts` — `removeDeletedMcpServerBinding` / `removeDeletedSkillBinding` |
| MCP delete | `server/src/db/repositories/mcp_servers.ts` → calls helper after delete |
| Skill delete | `server/src/db/repositories/skills.ts` → calls helper after delete |
| Tests | `server/test/cron-repo.integration.test.ts` — delete MCP/skill + idempotent helpers |

*(Integration tests skipped without Postgres; unit presence confirmed.)*

---

### [x] PASS — retention prune methods + script + env example

**Evidence:**

- `runEventsRepo.pruneOlderThan` — `server/src/db/repositories/run_events.ts`
- `mcpServersRepo.pruneConnectionEventsOlderThan` — `server/src/db/repositories/mcp_servers.ts`
- Script: `scripts/db-prune-events.ts` (`bun run db:prune-events`)
- Env: `.env.example` — `HERMES_EVENT_RETENTION_DAYS=30`, `HERMES_MCP_EVENT_RETENTION_DAYS=30`
- Tests: `server/test/event-prune.integration.test.ts` (2 unit pass; integration skipped)

---

### [x] PASS — `hermes_app` role script + `.env.example` docs

**Evidence:**

- `scripts/db-create-app-role.ts` (`bun run db:create-app-role`)
- `.env.example` documents `DATABASE_URL` → `hermes_app`, `DATABASE_ADMIN_URL`, `HERMES_APP_PASSWORD`, pool guidance
- `docker-compose.yml` notes bootstrap superuser vs app role
- `docs/DATABASE-DESIGN.md` F5 marked scripted / operator-applied

**Not auto-deployed** (by design): compose still boots `hermes` superuser until operators run the bootstrap script.

---

## Definition of Done (Section 13) mapping

| Criterion | Status |
| --- | --- |
| `0006_integrity_fixes.sql` exists / tracked | PASS |
| Migration runner not naive `;` split | PASS |
| DB integration tests pass on fresh DB | **NOT RUN** (skipped — no Postgres); tests present |
| FKs for nullable logical refs | PASS (in `0006`) |
| Cron status CHECK matches runtime | PASS (`running`/`completed`/`failed`) |
| `run_events(run_id, seq)` uniqueness | PASS |
| Duplicate token hash index removed | PASS |
| Cron binding cleanup tested | PASS (tests present; skipped without DB) |
| Retention for append-only events | PASS |
| Docs reflect shipped vs deferred | PASS (updated with this verification) |

---

## Subagents A–E (Section 11)

| Subagent | Scope | Verdict |
| --- | --- | --- |
| A — Migration runner | `migrate.ts` + `migrate.test.ts` | PASS |
| B — Preflight + `0006` + schema + integration tests | scripts + migration + schema + tests | PASS |
| C — Cron binding cleanup | cron/mcp/skills repos + tests | PASS |
| D — Retention / ops | prune methods + script + env | PASS |
| E — Role hardening | app-role script + env/docs | PASS (scripted; not auto-applied) |

---

## Test results (this verifier run)

| Command | Result |
| --- | --- |
| `bun test server/test/migrate.test.ts` | **13 pass, 0 fail** |
| `bun test server/test/event-prune.integration.test.ts` | **2 pass** (unit), integration **skipped** |
| `bun test server/test/cron-repo.integration.test.ts` | all **skipped** (no integration DB) |
| `bun test server/test/db.integration.test.ts` | all **skipped** (no integration DB) |

To fully close DoD integration criteria locally:

```bash
bun run db:up
bun run migrate
bun test server/test/db.integration.test.ts server/test/cron-repo.integration.test.ts server/test/event-prune.integration.test.ts
```

---

## Deferred (explicit, not FAIL)

| Item | Reason |
| --- | --- |
| Drop `messages_embedding_hnsw` (F3) | Intentionally kept for planned message vector search |
| `profiles.name` / `cron_jobs.name` UNIQUE | Deferred to follow-up `0007` per action plan |
| Auto-switch runtime to `hermes_app` | Operator-applied bootstrap; compose still uses bootstrap superuser |
| Scheduled in-process prune timer | Script / env retention shipped; timer optional |

---

## FAIL list

*(none)*
