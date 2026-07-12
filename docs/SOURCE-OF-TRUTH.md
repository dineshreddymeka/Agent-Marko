# Source of truth

**Product:** **Open Jarvis**  
**Author:** Dinesh Reddy Meka  
**Authoritative plan:** [`BMC-backend/HERMES-UI-PLAN.md`](../../BMC-backend/HERMES-UI-PLAN.md)  
Absolute path: `C:\Users\dines\BMC\BMC-backend\HERMES-UI-PLAN.md`

This repo implements **Open Jarvis**. Local `PLAN.md`, `docs/PARITY.md`, and ADRs are working notes and must be reconciled **to** the BMC plan — never the reverse.

## Locked SoT decisions (do not drift)

- Product name: **Open Jarvis** (user-facing)
- Author / owner: **Dinesh Reddy Meka**
- Stack: Bun + React 19 + Vite + AG-UI + A2UI + Primer
- Database: **Postgres 17 + pgvector 0.8.5** (`pgvector/pgvector:0.8.5-pg17`) only — bind-mount `HERMES_DATA_DIR`
  ([DATABASE-DESIGN.md](./DATABASE-DESIGN.md), [ACTION-PLAN](./DATABASE-DESIGN-ACTION-PLAN.md), [verification](./DATABASE-DESIGN-VERIFICATION.md))
- MCP Settings: enterprise **Connections** console (search, status filters, connectivity pipeline, Connect actions)
- Logging: correlation IDs + `DEBUG_*` channels — see [LOGGING.md](./LOGGING.md)
- Upstream reference only: [nesquena/hermes-webui](https://github.com/nesquena/hermes-webui)
- License rule: MIT / Apache-2.0 / PostgreSQL License only
- Descoped: Voice/TTS; multi-user teams

## Parallel workstream map

See `docs/PARALLEL-AGENT-PLAN.md` (feature completion matrix against the BMC SoT).  
Verification proofs: [FEATURE-VERIFICATION.md](./FEATURE-VERIFICATION.md).  
**Rebuild work log (auto-hook):** [HERMES-UI-REBUILD-TRACKER.md](./HERMES-UI-REBUILD-TRACKER.md) — updated after agent turns via `.cursor/hooks/plan-tracker.mjs`.
