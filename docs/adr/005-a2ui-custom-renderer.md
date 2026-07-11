# ADR-005: Custom A2UI renderer (catalog mapped to Primer)

## Status

Accepted

## Context

A2UI v0.9 React packages were unstable at implementation time. Hermes needs generative UI with custom widgets (SkillCard, MemoryEditor, CronPicker).

## Decision

Implement **`lib/a2ui/processor.ts`** + React catalog components styled with Primer tokens instead of pinning `@a2ui/react`. Custom widget IDs live in `packages/shared/a2ui-catalog.ts`.

## Consequences

- Full control over styling and action round-trips
- Easy to swap in official `@a2ui/react` later behind the same processor interface
- Server `a2ui_render` tool validates against shared catalog schemas
