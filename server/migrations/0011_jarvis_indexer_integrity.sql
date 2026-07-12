-- Jarvis indexer integrity fixes: lock fencing, chunk counts, unique active jobs.

ALTER TABLE index_jobs
  ADD COLUMN IF NOT EXISTS lock_token UUID,
  ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS rerun_requested BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE jarvis_index_documents
  ADD COLUMN IF NOT EXISTS chunk_count INT NOT NULL DEFAULT 0;

-- One active job per source (pending/running). Failed/done may accumulate history.
CREATE UNIQUE INDEX IF NOT EXISTS index_jobs_active_source_uidx
  ON index_jobs (source_type, source_id)
  WHERE status IN ('pending', 'running');

CREATE UNIQUE INDEX IF NOT EXISTS jarvis_index_action_links_unique_idx
  ON jarvis_index_action_links (action_id, target_type, target_id);

CREATE INDEX IF NOT EXISTS index_jobs_lock_token_idx
  ON index_jobs (lock_token)
  WHERE lock_token IS NOT NULL;

ANALYZE index_jobs;
ANALYZE jarvis_index_documents;
ANALYZE jarvis_index_action_links;
