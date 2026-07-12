# Open Jarvis — Parallel Workstream Feature Completion Plan

**Author:** Dinesh Reddy Meka  
**Product:** Open Jarvis  

**Repo path (unchanged):** `C:\Users\dines\BMC\hermes-ui` (packages may still use `@hermes/*`)  
**Source of truth:** `C:\Users\dines\BMC\BMC-backend\HERMES-UI-PLAN.md`  
**Mandate:** Every SoT-listed feature must work end-to-end. No stubs. No “signed off thin.” No descopes except items the SoT never requires (Voice/TTS, multi-user teams).  
**Audit date:** 2026-07-11  

Local `PLAN.md` / `docs/PARITY.md` claim phases done — **ignore for completion**. This matrix is authoritative for workers.

---

## 1. Executive summary

Scaffold + AG-UI/A2UI shells exist, but many SoT surfaces are **partial, stubbed, or missing**. Highest blockers:

| Priority | Gap | Why it blocks “Open Jarvis works” |
|----------|-----|-----------------------------------|
| P0 | **Postgres 17 vs SoT PG17** | Wrong image, wrong volume path, CI + ADR drift |
| P0 | **MCP HTTP stub** | SoT requires stdio + HTTP/SSE; HTTP returns stub error |
| P0 | **Auth depth missing** | No OAuth, no API tokens table/UI, no login page, no Drizzle adapter |
| P0 | **Composer attachments + slash depth** | Paperclip dead; most slash cmds no-ops |
| P0 | **Compute pool stub** | Workers unused; status `'stub'` |
| P1 | **Panels thin** | Sessions/workspace/skills/memory/cron/profiles lack SoT UX depth |
| P1 | **A2UI catalog incomplete** | Many standard components → “Unknown”; action round-trip weak |
| P1 | **web_search stub** | Agent tool returns stub payload |
| P1 | **Skills git sources + learn.ts** | Folder sync only; no git clone/pull module |
| P2 | **PG ultra ops** | Backup retention, restore verify, pool metrics, HNSW tuning incomplete |

**Explicitly out of scope (SoT does not require):** Voice/TTS, multi-user teams.

---

## 2. PG17 → PG17 migration risk (`C:/hermes-data`)

SoT locks **`pgvector/pgvector:0.8.5-pg17`** and mount:

```text
${HERMES_DATA_DIR}/postgres → /var/lib/postgresql/data   # PG17 parent (not …/data)
```

**Current Open Jarvis compose:** `0.8.5-pg17` → `/var/lib/postgresql/data`.

| Risk | Detail | Mitigation (W3 owns) |
|------|--------|----------------------|
| **Data dir incompatibility** | PG major versions cannot reuse the same data files | Never point PG17 at existing PG17 `…/postgres` data |
| **Mount path change** | SoT uses parent `/var/lib/postgresql/data`; PG17 used `…/data` | New empty dir for PG17 (e.g. `C:/hermes-data/postgres18`) or documented layout under parent |
| **Silent wipe risk** | Switching image without dump → container fails or empty DB | **Mandatory** `bun run db:backup` before any compose change |
| **CI still pg17** | `.github/workflows/ci.yml` uses pg17 | Flip with compose in same PR |
| **ADR-002** | Still says PG17 / Artifactory | Rewrite to SoT PG17 |

**Safe cutover sequence (acceptance):**

1. `bun run db:backup` → verify non-empty dump under `HERMES_BACKUP_DIR`
2. Stop compose; leave old `C:/hermes-data/postgres` untouched
3. Set new mount dir (or empty PG17 parent path per SoT)
4. Image `pgvector/pgvector:0.8.5-pg17`; mount `/var/lib/postgresql/data`
5. `bun run db:up && bun run migrate`
6. `bun run db:restore <dump>` then **verify script**: row counts / `SELECT extversion FROM pg_extension WHERE extname='vector'`
7. Update CI + ADR-002 + README; keep old PG17 dir until restore verified

---

## 3. Workstream map (W1–W5) — no file overlap

| Workstream | Owns | Phase focus | Do NOT touch |
|--------|------|-------------|--------------|
| **W1** | Chat + AG-UI client + composer + frontend tools + state panel | SoT Phase 4 (+ chat-facing 7) | `docker-compose`, `server/src/mcp`, `server/src/auth`, `server/src/db`, panels except chat shell hooks |
| **W2** | MCP HTTP, skills git/learn, web tools, compute pool, auth/OAuth/tokens, providers depth | SoT Phase 3d–3e (+ tool depth) | `app/src/components/chat/*`, `docker-compose.yml`, panel list UIs (except Settings auth/MCP tabs W2+W4 contract) |
| **W3** | Postgres 17, schema dim, HNSW/pool/backup/restore/health ultra, vector ranking | SoT Phase 2 + §7–8 ultra | Frontend components, MCP manager, composer |
| **W4** | Sessions/workspace/skills/memory/cron/profiles/settings panels + search UX + IndexedDB | SoT Phase 6 | `server/src/mcp/manager.ts`, `docker-compose`, AG-UI runtime core |
| **W5** | A2UI full catalog + action E2E, polish (palette/kbd/mobile/CSP/licenses), SoT checklist sync | SoT Phase 5 + 7 + docs | DB migrations, MCP transports, auth core |

**Shared contracts (coordinate, don’t fork):**

- REST DTO shapes in `packages/shared`
- `/api/settings/mcp` + auth token routes (W2 server, W4 UI)
- Custom events `hermes.*` names may stay in code; UI copy says **Open Jarvis**

**Priority order for all workers:** broken/missing → partial → polish.

---

## 4. FEATURE COMPLETION MATRIX

Status legend: **works** | **partial** | **broken** | **missing**

### 4.1 SoT checklist (top of BMC plan)

| # | SoT item | Status | Owner | Acceptance test (must pass) |
|---|----------|--------|-------|------------------------------|
| C1 | Phase 1a monorepo Bun/Vite/React19/TS/Tailwind/tests | **partial** | W5 | `bun install && bun test` green; workspaces `app`/`server`/`packages/shared` present |
| C2 | Phase 1b Primer shell + themes + router | **partial** | W5 | Theme dark/dim/light; rail/sidebar/chat/right panel; routes `/` `/session/$id` `/panel/$name` |
| C3 | Phase 2 Postgres **18** + pgvector 0.8.5 + DDL + Bun.sql + repos + backup | **broken** | W3 | Compose image `0.8.5-pg17`; mount `/var/lib/postgresql/data`; `db:up`+`migrate`+repo tests; backup/restore verify |
| C4 | Phase 3a AG-UI POST `/agui` SSE + cancel | **partial** | W1/W2 | `curl -N` multi-event run; `DELETE /agui/:runId` cancels mid-stream |
| C5 | Phase 3b providers native + agui-remote + hermes-python + delegate | **partial** | W2 | Profile switches provider; remote relay; python bridge with `HERMES_PYTHON_URL`; nested `delegate_to_agent` events visible in parent |
| C6 | Phase 3c embeddings + HNSW recall in context | **partial** | W3/W2 | Save memory → new session recall in prompt/context; hybrid `/api/search` returns semantic hits |
| C7 | Phase 3d MCP stdio+**HTTP** + SKILL.md folder/**git** + skill_save | **broken** | W2 | HTTP MCP connects; tools/resources/prompts work; git skill source clone+sync; skill_save → learned folder+DB |
| C8 | Phase 3e better-auth+OAuth+API tokens+guards; compute pool+run_code | **broken** | W2 | Login page; GitHub/Google OAuth; token CRUD+bearer on REST/AG-UI; pool status≠stub; run_code limits enforced |
| C9 | Phase 4a composer slash+**attachments**; virtualized list; md/Shiki; tools; thinking | **broken** | W1 | Attach upload persists+sent with turn; all registry slash cmds work; 10k scroll; tool/thinking cards |
| C10 | Phase 4b client events+recovery+HITL+cancel+error retry | **partial** | W1 | Reload mid-run recovers; approval approve/reject/always; ErrorBanner **retries** last run (not dismiss-only) |
| C11 | Phase 4c state panel+frontend tools+custom events | **partial** | W1 | STATE_DELTA/SNAPSHOT edit round-trip; `open_file_preview` opens file; context ring from `hermes.context`; title from `hermes.title` |
| C12 | Phase 5 A2UI full catalog+Hermes widgets+action round-trips | **partial** | W5 | Standard catalog unit green; action REST mocked; live cron row needs PG17 |
| C13 | Phase 6 all panels at SoT depth | **partial** | W4 | Each panel AC in §4.3; parity checklist real |
| C14 | Cross-cutting logging+replay+debug+errors+ADRs+lint boundaries | **partial** | W2/W5 | `DEBUG_LLM=1` dumps; replay UI; ESLint restricted paths; ADRs match SoT (PG17) |
| C15 | Phase 7 palette+kbd+mobile+themes+empty states+licenses+README | **partial** | W5 | Palette/kbd/CSP/licenses/Open Jarvis branding; Lighthouse still optional gate |

### 4.2 SoT § features (backend / protocols / ops)

| ID | Feature | Status | Owner | Acceptance test |
|----|---------|--------|-------|-----------------|
| B1 | `AgentProvider` registry + per-profile selection | **partial** | W2 | Create profile `provider=agui-remote` with URL → chat uses remote |
| B2 | `delegate_to_agent` nested streaming in **parent** transcript | **partial** | W2 | Parent SSE shows nested run events (not only tool JSON dump) |
| B3 | MCP stdio transport | **works** | W2 | Add stdio server → tools namespaced `mcp:name/tool` + approval |
| B4 | MCP HTTP/streamable + SSE | **broken** | W2 | HTTP URL connects; no stub error string |
| B5 | MCP reconnect/backoff + auth headers | **missing** | W2 | Kill MCP → auto-reconnect; headers forwarded |
| B6 | MCP resources → context builder | **missing** | W2 | Resource content injectable in context |
| B7 | MCP prompts → composer slash `/mcp:…` | **missing** | W1/W2 | Prompt appears in slash autocomplete + inserts |
| B8 | MCP tool schemas + whitelist UI | **partial** | W2/W4 | Discovered JSON schema on tools; per-tool whitelist toggle works |
| B9 | Skills folder sync | **works** | W2 | `POST /api/skills/sync` loads SKILL.md |
| B10 | Skills **git** sources | **missing** | W2 | Add git URL → clone/pull cache → sync `git:<url>` |
| B11 | `skills/learn.ts` module + learning loop polish | **partial** | W2 | skill_save path documented; learn helpers exist; panel export learned |
| B12 | Vector dim SoT default **1024** (configurable) | **broken** | W3 | Schema/`EMBEDDING_DIMENSION` match model; migrate path documented (now 1536) |
| B13 | HNSW indexes + query `ef_search` tuning | **partial** | W3 | Indexes present; SET/ef_search in search path; ranking uses recency/importance |
| B14 | Async indexer + FTS degrade | **partial** | W3 | Queue depth in debug health; search works without embeddings |
| B15 | Bun.sql pool sizing/metrics | **partial** | W3 | Configurable pool; debug health shows pool stats |
| B16 | Backup + **retention** + restore **verify** | **partial** | W3 | Retention policy script; `db:restore:verify` asserts tables/extensions |
| B17 | Docker resource/shm + PG conf ultra | **partial** | W3 | SoT image+mount; keep/extend shm/shared_buffers; document |
| B18 | better-auth email/password + single-user bootstrap | **partial** | W2 | First-run owner; `ALLOW_SIGNUP=false` locks reg |
| B19 | OAuth GitHub + Google | **missing** | W2 | Sign-in buttons work with env client IDs |
| B20 | Optional TOTP 2FA | **missing** | W2 | Enable TOTP; login requires code |
| B21 | API tokens hashed/scoped/revocable | **missing** | W2/W4 | Create token → bearer works → revoke → 401 |
| B22 | Auth guards on REST + AG-UI when non-localhost | **partial** | W2 | Bind `0.0.0.0` → unauthenticated 401 |
| B23 | Login page in app | **missing** | W2/W5 | `/login` route; session cookie |
| B24 | Compute Bun Workers pool (real offload) | **broken** | W2 | Embed/diff jobs on workers; status≠`stub` |
| B25 | `run_code` sandbox timeout/memory/no-network | **partial** | W2 | Tests prove timeout + network blocked |
| B26 | `web_search` configured provider | **broken** | W2 | Non-stub results with API key/env |
| B27 | `fetch_url` production-ready | **partial** | W2 | Size limits, content-type, timeout (label not stub) |
| B28 | Session title `hermes.title` generation | **partial** | W2 | First exchange updates DB title + UI |
| B29 | `DEBUG_LLM=1` rotating dumps | **missing** | W2 | Files under `${HERMES_DATA_DIR}/logs` redacted |
| B30 | `GET /api/debug/health` full SoT fields | **partial** | W3/W2 | DB pool, MCP, runs, mem, embed queue |
| B31 | Run event record + replay UI | **partial** | W5 | Replay past run through dispatcher without LLM |
| B32 | CSP headers in prod | **works** | W5 | `security-headers.ts` + `HERMES_CSP=1` / production |
| B33 | ESLint import boundary rules | **works** | W5 | `rest/`↛`agent/`; components↛repos |
| B34 | IndexedDB Query persister | **missing** | W4 | Offline reload shows cached sessions list |
| B35 | `GET /api/sessions/:id/live` recovery wiring | **partial** | W1 | Client uses live endpoint on mount |
| B36 | KaTeX + Mermaid in markdown | **missing** | W1 | Formula + mermaid fence render |
| B37 | Message timestamps | **missing** | W1 | HH:MM + hover full date (upstream-parity SoT chat quality) |
| B38 | Open Jarvis user-facing branding | **works** | W5 | UI strings/README say Open Jarvis (code paths may stay hermes) |

### 4.3 SoT Phase 6 panels (detail)

| ID | Feature | Status | Owner | Acceptance test |
|----|---------|--------|-------|-----------------|
| P1 | Sessions grouped by group/date, collapsible | **missing** | W4 | Sidebar shows Today/Yesterday/groups |
| P2 | Pin / archive / rename inline / delete confirm | **partial** | W4 | All four work + persist via REST |
| P3 | Session search FTS+semantic with preview | **missing** | W4 | Search box → `/api/search` → jump to match |
| P4 | Profile/project picker per session | **missing** | W4 | Assign profile/group; list filters |
| P5 | New session **persists** to API (not Zustand-only) | **broken** | W1/W4 | Reload keeps session |
| P6 | Workspace lazy tree matching API shape | **broken** | W4 | Tree renders dirs from REST (fix mismatch today) |
| P7 | Preview Shiki + images + markdown | **partial** | W4 | Code highlighted; md rendered; image shown |
| P8 | Upload / download / edit-save | **missing** | W4 | Upload file; download; edit save via PUT |
| P9 | Git status badge | **missing** | W4 | Dirty count + branch in header |
| P10 | Skills markdown editor + semantic search + export | **missing** | W4 | Edit body_md; search; export learned zip/md |
| P11 | Skills git source management UI | **missing** | W4 | Add/remove git source triggers W2 sync |
| P12 | MCP panel: edit/enable/status/tools/whitelist/test | **partial** | W4 | Test shows real status; whitelist persists |
| P13 | Memory edit/delete + importance + query box | **partial** | W4 | Edit/delete mutate API; search returns memories |
| P14 | Cron create UI + schedule preview + run history | **partial** | W4 | Create job; human schedule; history links session |
| P15 | Profiles CRUD + prompt/model/temp/provider + default | **partial** | W4 | Full CRUD; set default; composer shows model |
| P16 | Settings LLM key masked + embeddings + export JSON | **partial** | W4 | Key masked; export downloads dump |
| P17 | Optimistic mutations + toasts | **missing** | W4 | Fail rolls back + toast |

### 4.4 SoT Phase 4 / 5 / 7 UI detail

| ID | Feature | Status | Owner | Acceptance test |
|----|---------|--------|-------|-----------------|
| U1 | Slash registry `/new /clear /model /skill /memory /cron /theme` | **broken** | W1 | Each command performs SoT behavior (not no-op) |
| U2 | Slash keyboard nav (arrows/Tab/Esc) | **missing** | W1 | Keyboard selects command |
| U3 | Attachments upload to API + include in run | **broken** | W1 | Paperclip → file on disk/DB → agent sees path |
| U4 | Auto-grow textarea | **partial** | W1 | Grows with content to max |
| U5 | Stop cancels run | **works** | W1 | Stop → RUN cancel |
| U6 | ErrorBanner retry-run | **broken** | W1 | Retry re-sends last user turn |
| U7 | Approval always-allow session/tool | **works** | W1 | Round-trip with server |
| U8 | Frontend tools all four | **partial** | W1 | `open_file_preview` selects path; chart visible; theme; panel |
| U9 | A2UI standard catalog complete | **works** | W5 | Image, Select, Radio, Checkbox, DateTime, Slider, List, Table, Tabs, Video, Audio + unit render |
| U10 | A2UI action → agent side effect | **partial** | W5 | Cron/memory REST from `sendA2UIAction`; live PG row E2E still needs W3 PG17 |
| U11 | Command palette slash + “new session with profile” | **works** | W5 | Profile picker entry + shortcuts group in palette |
| U12 | Keyboard map SoT complete | **works** | W5 | Ctrl+N, Ctrl+Alt+B, Esc, documented in palette |
| U13 | Mobile bottom nav + drawer + safe-area | **works** | W5 | Phone viewport usable |
| U14 | Global error boundary copy-diagnostics | **works** | W5 | Copies version+events+store |

---

## 5. Postgres Ultra checklist (SoT: **PG17** — not PG17)

Must keep: **`pgvector/pgvector:0.8.5-pg17`**.

| Item | Status | Owner | Done when |
|------|--------|-------|-----------|
| Image tag PG17 | **broken** | W3 | compose + CI use `0.8.5-pg17` |
| Mount `/var/lib/postgresql/data` | **broken** | W3 | Matches SoT §8 |
| Bind mount outside repo | **works** | W3 | `HERMES_DATA_DIR` |
| Healthcheck `pg_isready` | **works** | W3 | — |
| `shm_size` + tuned `command:` | **partial** | W3 | Documented + validated under load |
| Pool max configurable + metrics | **partial** | W3 | Debug health |
| HNSW `m`/`ef_construction` + query `ef_search` | **partial** | W3 | Search path sets ef_search |
| GIN FTS + btree session/created | **works** | W3 | — |
| Embedding dim SoT-aligned | **broken** | W3 | 1024 default or env-driven migrate |
| Backup timestamped | **works** | W3 | — |
| Backup retention (N days / count) | **missing** | W3 | Old dumps pruned |
| Restore + verify script | **partial** | W3 | `db:restore:verify` exit 0 |
| PG17 data preserved during cutover | **risk** | W3 | See §2 |

---

## 6. Priority order (execute in this order)

1. **W3 P0:** PG17 cutover + backup/restore verify (unblocks all DB AC)  
2. **W2 P0:** MCP HTTP; auth/OAuth/tokens/login; compute pool destub; web_search  
3. **W1 P0:** Session persist; attachments; slash commands; ErrorBanner retry; KaTeX/Mermaid  
4. **W4 P0:** Workspace tree fix; sessions groups/search; panel CRUD depth  
5. **W5 P0:** A2UI full catalog + real action E2E; branding Open Jarvis; CSP/licenses/ADR sync  
6. Then all **partial** rows until every matrix cell is **works**

---

## 7. Risks

| Risk | Mitigation |
|------|------------|
| PG17 data loss on PG17 switch | Dump-first; new data dir; restore verify before deleting old |
| Workstreams collide on `packages/shared` | Contract PRs small; announce DTO changes |
| A2UI package churn | Pin versions; isolate `app/src/lib/a2ui` |
| Auth breaks localhost DX | Keep 127.0.0.1 bypass; enforce on non-localhost |
| Fake green via mocks | AC requires non-`HERMES_MOCK_LLM` path where SoT says real; mocks only for unit tests |
| Branding vs package names | User-facing **Open Jarvis**; `@hermes` / `hermes-ui` paths OK until rename epic |

---

## 8. Sync notes (docs only — update when closing gaps)

| File | Action |
|------|--------|
| `BMC-backend/HERMES-UI-PLAN.md` | Remains SoT; checkboxes flip only when matrix row **works** |
| `hermes-ui/PLAN.md` | Reconcile **to** BMC (PG17); do not claim done early |
| `docs/PARITY.md` | Rewrite from this matrix; remove false ✅ |
| `docs/adr/002-postgres-pgvector.md` | PG17 + SoT mount path |
| `docs/SOURCE-OF-TRUTH.md` | Already points at BMC; keep |
| README / UI copy | Product name **Open Jarvis**; author **Dinesh Reddy Meka** |

---

## 9. Definition of done (Open Jarvis)

- Every row in §4 is **works** (except Voice/TTS & multi-user teams — not in SoT).  
- `bun run verify:all` green against **PG17**.  
- Manual SoT Phase 4–7 ACs pass without stubs.  
- User-facing product name is **Open Jarvis**.  

**Author:** Dinesh Reddy Meka  
