# ADR-003: AG-UI orchestration server (not framework-specific backend)

## Status

Accepted

## Context

The UI must speak AG-UI natively while supporting multiple agent backends (native Hermes loop, remote LangGraph/CrewAI endpoints, legacy Python Hermes).

## Decision

Bun **orchestration server** with `AgentProvider` registry (`native`, `agui-remote`, `hermes-python`). Single `POST /agui` SSE endpoint using `@ag-ui/core` event encoding.

## Consequences

- Framework-agnostic: new providers are one file + registration
- All runs recorded to `run_events` for replay
- Remote providers relay streams without reimplementing tools
