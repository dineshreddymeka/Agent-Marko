# ADR-001: Bun as universal runtime

**Author:** Dinesh Reddy Meka

## Status

Accepted

## Context

Open Jarvis needs a fast dev loop on Windows, native Postgres access, and a single language across frontend tooling and backend.

## Decision

Use **Bun** for package management, test runner, dev server (`Bun.serve`), and SQL (`Bun.sql`).

## Consequences

- Excellent local DX with `--hot` reload
- No separate Node driver for Postgres
- Windows CI must verify `bun test` early; server uses Bun-specific APIs at the edge only
