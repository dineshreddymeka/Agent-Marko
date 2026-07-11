# ADR-004: better-auth with single-user bootstrap

## Status

Accepted

## Context

Local-first agent UI needs optional auth for LAN deployment and API token access without heavy IAM.

## Decision

**better-auth** with email/password, OAuth-ready schema, API tokens, and route guards on REST + AG-UI. `ALLOW_SIGNUP=false` enables single-user bootstrap; localhost dev bypass when auth unset.

## Consequences

- Login page in app; tokens for automation
- Drizzle adapter shares the main schema
- Multi-tenant RBAC explicitly out of scope
