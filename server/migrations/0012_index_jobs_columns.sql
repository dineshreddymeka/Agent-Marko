-- Repair incomplete index_jobs columns (0008 may have been applied against an older draft).

ALTER TABLE index_jobs
  ADD COLUMN IF NOT EXISTS action_id UUID,
  ADD COLUMN IF NOT EXISTS run_id UUID,
  ADD COLUMN IF NOT EXISTS user_id TEXT,
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS index_jobs_action_idx
  ON index_jobs (action_id)
  WHERE action_id IS NOT NULL;

ANALYZE index_jobs;
