import { getSql } from '../../src/db/client'
import { runMigrations } from '../../src/db/migrate'

export async function isIntegrationEnabled(): Promise<boolean> {
  if (process.env.HERMES_INTEGRATION_TEST !== '1') return false
  const url = process.env.DATABASE_URL ?? ''
  if (!/^postgres(ql)?:\/\/.+@(localhost|127\.0\.0\.1):5433\//.test(url)) {
    return false
  }
  try {
    const sql = getSql()
    await sql`SELECT 1 AS ok`
    return true
  } catch {
    return false
  }
}

export async function prepareIntegrationDb(): Promise<void> {
  await runMigrations()
  await truncateAppTables()
}

export async function truncateAppTables(): Promise<void> {
  const sql = getSql()
  await sql.unsafe(`
    TRUNCATE TABLE
      jarvis_index_action_links,
      jarvis_index_actions,
      jarvis_index_chunks,
      jarvis_index_documents,
      index_jobs,
      run_events,
      kanban_task_comments,
      kanban_task_links,
      kanban_tasks,
      messages,
      memory,
      skills,
      mcp_connection_events,
      mcp_servers,
      cron_runs,
      cron_jobs,
      settings,
      api_tokens,
      sessions,
      session,
      account,
      "user",
      verification
    RESTART IDENTITY CASCADE
  `)
}
