/**
 * CLI entry for the Jarvis MCP bridge (stdio server for Open Cowork).
 *
 * Run: `bun run server/src/cowork/mcp-bridge-main.ts`
 * (or `bun run cowork:mcp-bridge` from the repo root).
 *
 * Open Cowork spawns this via its `%APPDATA%/open-cowork/mcp-config.json`
 * entry — see mcp-register.ts / POST /api/cowork/mcp-bridge/register.
 */

// stdout is the MCP protocol channel. The Hermes logger writes info/debug via
// console.log, so route all console output to stderr before anything logs.
console.log = console.error.bind(console)
console.warn = console.error.bind(console)

const { startJarvisMcpBridge } = await import('./mcp-bridge')

await startJarvisMcpBridge()
console.error('[jarvis-mcp-bridge] ready (stdio)')
