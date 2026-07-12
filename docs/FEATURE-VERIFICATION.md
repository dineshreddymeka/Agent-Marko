# Open Jarvis — SoT feature verification matrix

**Author:** Dinesh Reddy Meka  
**Product:** Open Jarvis  
**Source of truth:** `C:\Users\dines\BMC\BMC-backend\HERMES-UI-PLAN.md`  

Maps every SoT checklist item to the script/test that must prove it. Status is **Pass / Fail / Blocked / Partial** from the latest local run — not from local `PLAN.md` progress notes.

SoT checklist items are marked `[x]` when implemented in tree (plan sync 2026-07-11). Use this matrix for **live proof** before treating a feature as production-signed.

| SoT item | Proof | Latest |
|----------|-------|--------|
| C1 Phase 1a scaffold | `bun test app server packages/shared` | Pass (unit) |
| C2 Phase 1b shell/themes | `bun test app`, e2e shell | Pass (unit) / e2e TBD |
| C3 Phase 2 PG17 | `verify:phase2`, CI postgres `0.8.5-pg17` | **Pass** — PG17 locked (`0.8.5-pg17`) |
| C4–C11 Phases 3–4 | `verify:phase3`, dispatcher/approval tests | Partial→improved (workers) |
| C12 Phase 5 A2UI full catalog + actions | `app/test/a2ui-catalog.test.ts`, `a2ui-actions.test.ts`, `verify:a2ui` | Catalog unit Pass; action REST mocked Pass |
| C13 Phase 6 panels (+ MCP Connections UI) | e2e panel routes; MCP search/pipeline/actions | Smoke routes Pass; MCP UI shipped |
| C14 Cross-cutting | `verify:offline`, ADRs, eslint boundaries, `docs/LOGGING.md` | Partial→logging shipped |
| C15 Phase 7 polish | palette/kbd/CSP/licenses/README | Partial→improved (W5) |

## W5-owned proof (Phase 5 + 7)

| ID | Feature | Proof |
|----|---------|-------|
| U9 | Standard A2UI catalog | `STANDARD_CATALOG_TYPES` (17) + catalog unit test |
| U10 | A2UI action → side effect | `sendA2UIAction` → `/api/cron` / `/api/memory` + AG-UI follow-up |
| U11 | Palette + new session with profile | CommandPalette items + e2e Ctrl+K |
| U12 | Keyboard map | Ctrl+K/N/B, Ctrl+Alt+B, Esc |
| U13 | Mobile nav + safe-area | `MobileNav` + e2e shell |
| U14 | ErrorBoundary diagnostics | Copy includes product + last 50 events + store snapshot |
| B32 | CSP prod headers | `server/src/security-headers.ts` + `csp.test.ts` |
| B33 | ESLint rest↛agent / components↛repos | `eslint.config.js` restricted imports |
| B38 | Open Jarvis branding | README, UI copy, docs |

## Verify commands

| Command | Covers |
|---------|--------|
| `bun test app server packages/shared` | Unit / smoke |
| `bun run verify:a2ui` | A2UI demo SSE scenarios |
| `bun run test:e2e` | Playwright shell / panels / palette |
| `bun run verify:offline` | Debug replay buffer |
| `bun run verify:lighthouse` | Perf ≥ 90 |
| `bun run verify:all` | Full matrix |

See [PARALLEL-AGENT-PLAN.md](./PARALLEL-AGENT-PLAN.md).

## Latest run

**Author:** Dinesh Reddy Meka · **When:** 2026-07-11  

| Gate | Result |
|------|--------|
| `bun test app server packages/shared` | **90 pass, 1 fail, 8 skip** |
| A2UI catalog + action unit tests | **Pass** |
| CSP unit tests | **Pass** |
| DB integration | **Skipped** (no `HERMES_INTEGRATION_TEST`) |

### Failing / unproven SoT features

| ID | Feature | Status | Owner |
|----|---------|--------|-------|
| C3 | Compose/CI `0.8.5-pg17` + mount `/var/lib/postgresql/data` | **Pass** — PG17 locked | W3 |
| C7–C9 | MCP HTTP, auth depth, composer attachments | In tree; deepen live E2E | W1/W2/W4 |
| P12 | MCP Connections enterprise UI | **Shipped** — search, filters, pipeline, tools/resources/prompts | — |
| U10 live | A2UI → real `cron_jobs` row | Unit-mocked Pass; live E2E needs PG17 API | W5+W3 |

Live proof still runs through `verify:*` / Playwright; SoT checklist `[x]` means implemented in tree (synced 2026-07-11).
