/**
 * Open Jarvis — Phase 3d/3e server notes (MCP, auth, compute, tools)
 * Author: Dinesh Reddy Meka
 *
 * Smoke tests (localhost):
 * 1. MCP HTTP: POST /api/mcp { name, transport:"http", url } then POST /api/mcp/:id/test
 * 2. Skills git: POST /api/skills/sync { "gitUrl": "https://..." } or manage /api/skills/sources
 * 3. web_search: agent tool uses WEB_SEARCH_PROVIDER + WEB_SEARCH_API_KEY (or DuckDuckGo)
 * 4. Auth: HOST=0.0.0.0 → 401 without cookie/token; POST /api/tokens → Bearer hrm_…
 * 5. OAuth: set GITHUB_/GOOGLE_ CLIENT_ID+SECRET; open /login
 * 6. Compute: GET /api/debug/health → compute.status === "ready"
 * 7. TOTP: ENABLE_TOTP=1 enables better-auth twoFactor plugin
 */
export {}
