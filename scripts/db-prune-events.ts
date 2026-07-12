/**
 * Prune append-only event logs past configured retention.
 *
 * Deletes rows older than:
 *   - HERMES_EVENT_RETENTION_DAYS (default 30) from `run_events`
 *   - HERMES_MCP_EVENT_RETENTION_DAYS (default 30) from `mcp_connection_events`
 *
 * Recent events are kept. Safe to run repeatedly (ops / cron).
 *
 * Usage: bun run db:prune-events
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const root = import.meta.dir.replace(/[/\\]scripts$/, '')

async function loadEnv(): Promise<void> {
  const envPath = join(root, '.env')
  if (!existsSync(envPath)) return
  const text = await Bun.file(envPath).text()
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const idx = trimmed.indexOf('=')
    if (idx === -1) continue
    const key = trimmed.slice(0, idx)
    const value = trimmed.slice(idx + 1)
    if (!process.env[key]) process.env[key] = value
  }
}

async function main() {
  await loadEnv()
  // Dynamic imports so `.env` retention vars are visible to loadConfig().
  const { config } = await import('../server/src/config')
  const { runEventsRepo } = await import('../server/src/db/repositories/run_events')
  const { mcpServersRepo } = await import('../server/src/db/repositories/mcp_servers')

  const runDays = config.HERMES_EVENT_RETENTION_DAYS
  const mcpDays = config.HERMES_MCP_EVENT_RETENTION_DAYS

  console.log(`Pruning run_events older than ${runDays} day(s)...`)
  const runDeleted = await runEventsRepo.pruneOlderThan(runDays)
  console.log(`  deleted ${runDeleted} row(s)`)

  console.log(`Pruning mcp_connection_events older than ${mcpDays} day(s)...`)
  const mcpDeleted = await mcpServersRepo.pruneConnectionEventsOlderThan(mcpDays)
  console.log(`  deleted ${mcpDeleted} row(s)`)

  console.log('db:prune-events complete')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
