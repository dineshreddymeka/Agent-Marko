# ADR-004: better-auth with single-user bootstrap

## Status

Accepted

## Author

Dinesh Reddy Meka

## Context

Open Jarvis (local-first agent UI) needs optional auth for LAN deployment and API token access without heavy IAM.

## Decision

**better-auth** with email/password, OAuth-ready social providers, optional TOTP (`ENABLE_TOTP=1`), API tokens, and route guards on REST + AG-UI.

### Localhost bypass

When `HOST=127.0.0.1` and `ALLOW_SIGNUP=false`, auth is optional (local-first DX). Binding to a non-loopback host requires session or API token.

### OAuth hooks

Set env vars to enable providers:

- `GITHUB_CLIENT_ID` + `GITHUB_CLIENT_SECRET`
- `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET`

### API tokens

- Table `api_tokens` stores SHA-256 hashes (`hrm_…` shown once on create).
- CRUD: `GET/POST /api/tokens`, `DELETE /api/tokens/:id` (also `/api/settings/tokens`).
- `Authorization: Bearer hrm_…` accepted by guards.

### TOTP

Optional via better-auth `twoFactor` plugin when `ENABLE_TOTP=true`.

## Consequences

- Login at `/login`; tokens for automation/CI
- Multi-tenant RBAC out of scope
