-- Ensure index_jobs columns match the Drizzle schema (idempotent).
-- lock_token / rerun_requested may already exist from 0011.

ALTER TABLE index_jobs
  ADD COLUMN IF NOT EXISTS lock_token UUID,
  ADD COLUMN IF NOT EXISTS rerun_requested BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS index_jobs_lock_token_idx
  ON index_jobs (lock_token)
  WHERE lock_token IS NOT NULL;

ANALYZE index_jobs;
