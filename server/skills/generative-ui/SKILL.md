---
name: generative-ui
description: Build interactive generative UI (A2UI surfaces) in the chat transcript and stream them over AG-UI using the a2ui_render tool.
triggers: ["render ui", "generative ui", "a2ui", "show a form", "interactive widget", "build a card", "cron picker", "memory editor", "skill card", "file diff", "buttons", "surface"]
---

# Generative UI with A2UI over AG-UI

Use this skill whenever the best answer is an **interactive UI widget** rather than plain text — forms, cards, pickers, progress, confirmations, editors, or file diffs. You render UI by calling the **`a2ui_render`** tool; Hermes streams it to the frontend over AG-UI and the client renders it with its own components (no code execution).

## Background: two complementary protocols

- **AG-UI** — the Agent‑User Interaction Protocol (`ag-ui-protocol/ag-ui`). An event-based streaming layer (`RUN_STARTED`, `TEXT_MESSAGE_*`, `THINKING_*`, `TOOL_CALL_*`, `CUSTOM`, `RUN_FINISHED`) between an agent backend and a frontend. Hermes uses it as the transport for everything, including generative UI (the `a2ui.message` CUSTOM event).
- **A2UI** — Agent‑to‑UI generative UI format (`a2ui-project/a2ui`, aka `google/A2UI`; by Google + CopilotKit). Agents emit **declarative JSON describing UI intent**; the client renders it with native, pre‑approved components. Core idea: **separate UI structure (components) from content (data model)**. AG‑UI is the recommended A2UI transport — which is exactly how Hermes wires them.

## How Hermes exposes it

Call the tool:

```
a2ui_render({ payload: <A2UI message> })
```

That emits a CUSTOM AG‑UI event (`a2ui.message`) whose value is your `payload`. The frontend processor accumulates messages into a **surface** (a mini UI tree keyed by `surfaceId`) and renders each component via the Hermes catalog.

### Payload shape (Hermes)

Each `a2ui_render` call carries **one component** for a surface:

```json
{
  "surfaceId": "profile-card",      // stable id; reuse to update the same surface
  "component": {                     // the component to add/replace in the surface
    "id": "root",                    // unique within the surface
    "type": "Card",                  // catalog component type (see below)
    "props": { "title": "Profile" },
    "children": []                    // optional: array of child component ids
  },
  "data": { "name": "Alice" },       // optional: surface data model (merged)
  "complete": false                   // set true on the final message for the surface
}
```

- To build a multi‑component surface, call `a2ui_render` **once per component**, all sharing the same `surfaceId`, then send `"complete": true` on the last call.
- Re‑sending a component with the **same `component.id`** replaces it (use for updates/progress).
- **Data bindings:** any string prop written as `"{{path}}"` is resolved from the surface `data` model at render time. Send changing content via `data` (an `updateDataModel`‑style update) instead of re‑sending components.

## Component catalog

**Standard components** (props in parentheses):
- `Text` (`text`)
- `Button` (`label`, `action`) — click sends an action back to the agent
- `TextField` (`placeholder`, `value`) — change sends an action back to the agent
- `Card` (`title`, `children`)
- `Divider` ()
- `ProgressBar` (`value` 0–100)

**Hermes widgets** (domain-specific):
- `hermes:SkillCard` (`name`, `description`, `usageCount`)
- `hermes:MemoryEntryEditor` (`entryId`, `kind`: `semantic|episodic|preference`, `content`)
- `hermes:CronSchedulePicker` (`name`, `schedule` (cron expr), `prompt`)
- `hermes:FileDiff` (`path`, `before`, `after`)

Only these types render. An unknown `type` shows a "Unknown component" placeholder — never invent types.

## Actions (round trip)

Interactive components (`Button`, `TextField`, and the widgets) send an action back to the agent as an `actionResponse` (`{ surfaceId, action, data }`). Treat an incoming action as the user's response and continue the conversation (e.g. create the cron job they submitted). Keep `surfaceId` stable so follow‑up `a2ui_render` calls update the same surface.

## Worked examples

**A simple confirmation card:**
```
a2ui_render({ payload: { "surfaceId": "confirm", "component": { "id": "root", "type": "Card", "props": { "title": "Delete file?" } } } })
a2ui_render({ payload: { "surfaceId": "confirm", "component": { "id": "yes", "type": "Button", "props": { "label": "Delete", "action": "confirm_delete" } }, "complete": true } })
```

**A cron scheduler the user can submit:**
```
a2ui_render({ payload: { "surfaceId": "cron", "component": { "id": "root", "type": "hermes:CronSchedulePicker", "props": { "name": "Daily digest", "schedule": "0 9 * * *", "prompt": "Summarize overnight activity" } }, "complete": true } })
```

**Data-bound text that updates without re-sending the component:**
```
a2ui_render({ payload: { "surfaceId": "greet", "component": { "id": "root", "type": "Text", "props": { "text": "{{greeting}}" } } } })
a2ui_render({ payload: { "surfaceId": "greet", "data": { "greeting": "Hello, Alice!" }, "complete": true } })
```

## Best practices

- Prefer UI when it reduces typing or clarifies choices (pick a schedule, edit a memory entry, confirm a dangerous action, review a diff). Otherwise answer in text.
- Give every surface a **stable, meaningful `surfaceId`**; reuse it to update rather than spawning duplicates.
- Send `"complete": true` on the final message so the client knows the surface is done.
- Keep component ids unique within a surface; use `data` + `{{bindings}}` for values that change.
- Never emit component types outside the catalog above.

## References

- AG‑UI protocol: https://github.com/ag-ui-protocol/ag-ui · docs: https://docs.ag-ui.com/introduction
- A2UI protocol: https://github.com/a2ui-project/a2ui · spec v0.9.1: https://a2ui.org/specification/v0.9.1-a2ui/
- Hermes internals: `server/src/agent/tools/a2ui.ts` (tool), `app/src/lib/a2ui/processor.ts` (surface builder), `app/src/components/a2ui/catalog/index.tsx` (renderer), `packages/shared/src/a2ui-catalog.ts` (widget ids).
