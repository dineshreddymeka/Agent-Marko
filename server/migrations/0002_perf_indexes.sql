-- Performance indexes (Postgres 17 + pgvector). Safe / idempotent.
-- HNSW + GIN from 0001 re-asserted. btree helpers for common filters.

CREATE INDEX IF NOT EXISTS messages_search_gin ON messages USING GIN (search);

CREATE INDEX IF NOT EXISTS messages_embedding_hnsw
  ON messages USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE INDEX IF NOT EXISTS memory_embedding_hnsw
  ON memory USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE INDEX IF NOT EXISTS skills_embedding_hnsw
  ON skills USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE INDEX IF NOT EXISTS messages_session_created_idx ON messages (session_id, created_at);
CREATE INDEX IF NOT EXISTS messages_run_id_idx ON messages (run_id) WHERE run_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS sessions_updated_at_idx ON sessions (updated_at DESC);
CREATE INDEX IF NOT EXISTS sessions_archived_updated_idx ON sessions (archived, updated_at DESC);
CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions (user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS sessions_profile_id_idx ON sessions (profile_id) WHERE profile_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS memory_kind_idx ON memory (kind);
CREATE INDEX IF NOT EXISTS memory_user_id_idx ON memory (user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS memory_created_at_idx ON memory (created_at DESC);

CREATE INDEX IF NOT EXISTS cron_jobs_enabled_next_run_idx ON cron_jobs (enabled, next_run);
CREATE INDEX IF NOT EXISTS cron_jobs_next_run_idx ON cron_jobs (next_run ASC) WHERE enabled = TRUE;
CREATE INDEX IF NOT EXISTS cron_runs_job_started_idx ON cron_runs (job_id, started_at DESC);

CREATE INDEX IF NOT EXISTS run_events_run_seq_idx ON run_events (run_id, seq);
CREATE INDEX IF NOT EXISTS run_events_created_at_idx ON run_events (created_at DESC);
CREATE INDEX IF NOT EXISTS run_events_session_id_idx ON run_events (session_id, created_at) WHERE session_id IS NOT NULL;

ANALYZE messages;
ANALYZE memory;
ANALYZE skills;
ANALYZE sessions;
ANALYZE run_events;
ANALYZE cron_jobs;
ANALYZE cron_runs;
