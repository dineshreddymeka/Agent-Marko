---
name: copilotkit
description: Use CopilotKit (the React/Angular frontend stack behind AG-UI) to add copilot chat, frontend tools, shared state, and generative UI to an app.
triggers: ["copilotkit", "copilot kit", "copilot chat", "useCopilotAction", "useAgent", "useFrontendTool", "CopilotSidebar", "CopilotRuntime", "coagents", "frontend tool", "agent frontend"]
---

# CopilotKit — the frontend stack for AG-UI agents

Use this skill when asked to add an in-app **copilot / agent UI** to a React (or Angular/Vue/React Native/Slack) app, or to explain how CopilotKit relates to AG-UI and A2UI. CopilotKit (`CopilotKit/CopilotKit`) is made by the same team as **AG-UI** and is the UI layer that sits on top of it.

## Where it fits (vs AG-UI / A2UI)

- **AG-UI** = the wire protocol (~16 event types) between an agent backend and a frontend. It defines *how bytes move*.
- **CopilotKit** = the *frontend framework* that consumes AG-UI: ready-made chat UIs, hooks for tools/state, and generative UI. It defines *what the user sees and how the app reacts*.
- **A2UI** = a declarative format for agent-generated UI widgets; CopilotKit ships an A2UI runtime, and AG-UI is a transport for it.
- Rule of thumb: **agent logic stays the same — AG-UI handles the wire, CopilotKit handles the UI per framework** (M frameworks × N clients → M + N).

> This repo (Hermes) talks to `@ag-ui/client` **directly** rather than through CopilotKit. This skill is for building/advising on CopilotKit-based frontends, or for adopting CopilotKit as the UI layer over the same AG-UI backend.

## Quickstart (React)

Wrap the app in the provider and point it at your runtime endpoint:

```tsx
import { CopilotKit } from "@copilotkit/react-core"; // v2: "@copilotkit/react-core/v2"

function App() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit">
      <YourApp />
    </CopilotKit>
  );
}
```

Drop in a prebuilt chat surface:

```tsx
import { CopilotSidebar } from "@copilotkit/react-ui"; // v2: "@copilotkit/react-core/v2"
import "@copilotkit/react-ui/styles.css";

<CopilotSidebar labels={{ title: "Assistant" }} />;
// also available: <CopilotChat />, <CopilotPopup />
```

Backend runtime (Node): expose a `CopilotRuntime` at `runtimeUrl`:

```ts
import { CopilotRuntime } from "@copilotkit/runtime";
// mount at /api/copilotkit; connect your agent(s)
```

## Core building blocks

**Frontend tools** — let the model call functions in the browser, and optionally **render generative UI** while it runs:

```tsx
useCopilotAction({           // v2: useFrontendTool
  name: "showFlight",
  parameters: [{ name: "flightId", type: "string" }],
  handler: async ({ flightId }) => book(flightId),
  render: ({ args, status }) => <FlightCard id={args.flightId} loading={status !== "complete"} />,
});
```

**Readable context** — feed app state to the agent so it can reason over it:

```tsx
useCopilotReadable({ description: "current cart", value: cart }); // v2: useAgentContext
```

**Agent state / execution** — programmatic control over the connection, messages, and shared (co-)agent state:

```tsx
const { agent } = useAgent({ agentId: "my_agent" }); // v2; v1 equivalent: useCoAgent
// agent.isRunning, agent.state, messages, start/stop, etc.
```

## v1 → v2 API map

CopilotKit **V2** consolidates hooks + UI into `@copilotkit/react-core/v2` (backend/`CopilotRuntime` unchanged):

| v1 | v2 |
|----|----|
| `useCopilotAction` | `useFrontendTool` |
| `useCopilotReadable` / `useCopilotAdditionalInstructions` | `useAgentContext` |
| `useCoAgent` | `useAgent` |
| `useCopilotChat` | `useAgent` (headless: `useCopilotChatHeadless_c`) |
| `@copilotkit/react-ui` (+ `styles.css`) | `@copilotkit/react-core/v2` (+ `/v2/styles.css`) |

If you import `@ag-ui/client` directly, keep it on the latest version; CopilotKit's React v2 re-exports those types so a separate install isn't required.

## Generative UI: CopilotKit vs Hermes A2UI

- **CopilotKit**: generative UI is produced by an action's `render(...)` returning React while the agent streams — great when you own the React app and its components.
- **Hermes (this repo)**: the agent calls the `a2ui_render` tool → CUSTOM `a2ui.message` AG-UI event → the built-in A2UI surface renderer draws catalog components. See the `generative-ui` skill for the exact payload and catalog. Prefer `a2ui_render` here; reach for CopilotKit patterns only when building a separate CopilotKit frontend.

## When to use

- Building a new agent frontend in React/Next/Angular/Vue, or adding a copilot to an existing app → CopilotKit + a `CopilotRuntime` over AG-UI.
- Need in-browser tool calls, app-state awareness, or streaming generative UI in that frontend → the hooks above.
- Working inside Hermes itself → use its native `a2ui_render`/AG-UI paths (this repo does not bundle CopilotKit).

## References

- CopilotKit: https://github.com/CopilotKit/CopilotKit · docs: https://docs.copilotkit.ai
- V2 migration: https://docs.showcase.copilotkit.ai/built-in-agent/migrate/v2
- AG-UI: https://github.com/ag-ui-protocol/ag-ui · A2UI: https://github.com/a2ui-project/a2ui (see the `generative-ui` skill)
