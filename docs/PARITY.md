# Feature parity checklist

Compared against [nesquena/hermes-webui](https://github.com/nesquena/hermes-webui) feature set.

| Feature | Status | Notes |
|---------|--------|-------|
| Chat with streaming | ✅ | AG-UI SSE + virtualized message list |
| Tool call display | ✅ | ToolCallCard with live args → result |
| Thinking / reasoning blocks | ✅ | ThinkingBlock collapsible |
| Human-in-the-loop approval | ✅ | ApprovalCard + server approval gate |
| Session CRUD | ✅ | SessionsPanel + REST |
| Session groups / pin / archive | ✅ | Grouped sidebar, pin/archive actions |
| Auto session title | ✅ | `hermes.title` custom event |
| Workspace file tree | ✅ | WorkspacePanel lazy tree |
| File preview / edit | ✅ | Shiki preview, save via REST |
| Skills (SKILL.md) | ✅ | Loader + SkillsPanel + skill_save tool |
| Memory (semantic/episodic) | ✅ | pgvector search + MemoryPanel |
| Cron jobs | ✅ | Croner scheduler + CronPanel |
| Profiles (model/prompt) | ✅ | ProfilesPanel + per-profile provider |
| Settings | ✅ | LLM, theme, workspace, MCP sub-panel |
| MCP server integration | ✅ | stdio transport + tool bridge |
| Semantic search | ✅ | `/api/search` + vector pipeline |
| Command palette | ✅ | cmdk Ctrl+K |
| Keyboard shortcuts | ✅ | Sidebar/panel toggles, Esc cancel |
| Mobile responsive layout | ✅ | Bottom nav + drawer sidebar |
| Themes (dark/dim/light) | ✅ | Primer tokens via `data-theme` |
| A2UI generative UI | ✅ | Custom catalog + Hermes widgets |
| AG-UI shared state | ✅ | AgentStatePanel + JSON Patch |
| Frontend tools | ✅ | open_file_preview, switch_panel, etc. |
| Run replay / debug | ✅ | Debug panel + `/api/debug/runs/:id/events` |
| Auth / API tokens | ✅ | better-auth + route guards |
| Python Hermes bridge | ✅ | `hermes-python` provider (optional) |
| Voice / TTS | ⏭️ | Descoped — not in rebuild scope |
| Multi-user teams | ⏭️ | Single-user bootstrap only |

**Signed off:** implementation complete per engineering plan; voice and multi-tenant teams consciously descoped.
