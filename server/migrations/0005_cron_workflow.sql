-- Open Jarvis — Smart Cron enterprise workflow bindings
-- Author: Dinesh Reddy Meka
-- Extends cron_jobs with a JSONB workflow config plus denormalized uuid[]
-- binding columns (GIN-indexed) so "jobs using MCP X / skill Y" filters stay
-- one-hop array scans instead of JSON path scans. Adds cron_runs.detail for
-- per-run binding snapshots. Mirrors the typed-columns + JSONB pattern from
-- 0004_mcp_connections.sql.

ALTER TABLE cron_jobs
  ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'UTC',
  ADD COLUMN IF NOT EXISTS workflow JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS mcp_server_ids UUID[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS skill_ids UUID[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS cron_jobs_mcp_server_ids_gin ON cron_jobs USING GIN (mcp_server_ids);
CREATE INDEX IF NOT EXISTS cron_jobs_skill_ids_gin ON cron_jobs USING GIN (skill_ids);

ALTER TABLE cron_runs
  ADD COLUMN IF NOT EXISTS detail JSONB;

ANALYZE cron_jobs;
ANALYZE cron_runs;
