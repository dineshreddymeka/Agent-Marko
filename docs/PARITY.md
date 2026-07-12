# Open Jarvis — feature parity checklist

**Author:** Dinesh Reddy Meka

Compared against [nesquena/hermes-webui](https://github.com/nesquena/hermes-webui) feature set.  
**SoT remains** `BMC-backend/HERMES-UI-PLAN.md` — this table is a local working note, not a sign-off of the BMC checklist. Real completion status: [PARALLEL-AGENT-PLAN.md](./PARALLEL-AGENT-PLAN.md).

| Feature | Status | Notes |
|---------|--------|-------|
| Chat with streaming | ✅ | AG-UI SSE + virtualized list; HH:MM timestamps; KaTeX + Mermaid fences |
| Composer slash + attachments | ✅ | Slash registry + keyboard nav; workspace upload attached on send; `/new` persists via REST |
| Tool call display | ✅ | ToolCallCard live args → result (json/diff/plain/svg chart) |
| Thinking / reasoning blocks | ✅ | ThinkingBlock collapsible + live duration |
| Human-in-the-loop approval | ✅ | ApprovalCard + server approval gate |
| Error / retry | ✅ | ErrorBanner Retry re-runs last user turn without duplicating |
| Session recovery | ✅ | `GET …/live` + message poll while run in progress |
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
| Frontend tools | ✅ | open_file_preview selects path; switch_panel; render_chart SVG; set_theme |
| AG-UI shared state | ✅ | AgentStatePanel todos/plan/workspaceContext → next RunAgentInput.state |
| Run replay / debug | ✅ | Debug panel + `/api/debug/runs/:id/events` |
| Auth / API tokens | ✅ | better-auth + route guards |
| Python Hermes bridge | ✅ | `hermes-python` provider (optional) |
| Voice / TTS | ⏭️ | Descoped — not in rebuild scope |
| Multi-user teams | ⏭️ | Single-user bootstrap only |

**Signed off:** implementation complete per engineering plan; voice and multi-tenant teams consciously descoped.
