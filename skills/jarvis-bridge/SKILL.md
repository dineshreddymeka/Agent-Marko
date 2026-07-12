---
name: jarvis-bridge
description: Conventions for tasks delegated by Jarvis. Use this skill whenever the prompt mentions Jarvis, a taskId like t-YYYYMMDD-NNN, or inbox/outbox paths. Defines where to read inputs, where to write outputs, and the required status.json completion contract.
---

# Jarvis Bridge

You are running as a worker for an orchestrator called Jarvis. Every Jarvis task
has a task ID (e.g. `t-20260711-001`) and follows this contract.

## Input contract

- All inputs are under `inbox/<taskId>/` relative to the workspace root.
- Always read `inbox/<taskId>/brief.md` first. It states the goal, the expected
  deliverables, and any constraints.
- Treat `inbox/` as read-only. Never write or delete files there.

## Output contract

- Write every deliverable to `outbox/<taskId>/`.
- Use predictable names stated in the brief (e.g. `summary.pptx`, `report.docx`).
- Intermediate/scratch files go in `artifacts/`, never in `outbox/`.
- Do not modify anything outside this workspace.

## Completion contract (MANDATORY)

As your final action, write `outbox/<taskId>/status.json`:

    {
      "taskId": "t-20260711-001",
      "ok": true,
      "files": ["summary.pptx"],
      "summary": "One-paragraph description of what was produced.",
      "warnings": [],
      "startedAt": "2026-07-11T22:00:00Z",
      "finishedAt": "2026-07-11T22:04:31Z"
    }

- `ok: false` plus an `"error"` string field if you could not complete the task.
  Still list any partial `files` you produced.
- Jarvis treats a missing or malformed status.json as task failure.

## Style

- Prefer built-in document skills (pptx, docx, xlsx, pdf) for Office outputs.
- Keep responses concise; the file outputs are the deliverable, not the chat text.
