-- Open Jarvis - integrity fixes
-- Depends on 0001-0005.
-- Plain statements only (no DO $$ blocks) so naive migrate runners can apply this.

-- 1. Pre-clean nullable references before adding FKs.
UPDATE sessions s
SET profile_id = NULL
WHERE profile_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM profiles p WHERE p.id = s.profile_id);

UPDATE cron_jobs c
SET profile_id = NULL
WHERE profile_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM profiles p WHERE p.id = c.profile_id);

UPDATE memory m
SET source_session = NULL
WHERE source_session IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM sessions s WHERE s.id = m.source_session);

UPDATE cron_runs cr
SET session_id = NULL
WHERE session_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM sessions s WHERE s.id = cr.session_id);

UPDATE run_events re
SET session_id = NULL
WHERE session_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM sessions s WHERE s.id = re.session_id);

-- 2. Add nullable foreign keys (ON DELETE SET NULL).
-- messages.run_id stays FK-less (event-stream identity, not a parent table).
ALTER TABLE sessions
  ADD CONSTRAINT sessions_profile_fk
  FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE SET NULL;

ALTER TABLE cron_jobs
  ADD CONSTRAINT cron_jobs_profile_fk
  FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE SET NULL;

ALTER TABLE memory
  ADD CONSTRAINT memory_source_session_fk
  FOREIGN KEY (source_session) REFERENCES sessions(id) ON DELETE SET NULL;

ALTER TABLE cron_runs
  ADD CONSTRAINT cron_runs_session_fk
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE SET NULL;

ALTER TABLE run_events
  ADD CONSTRAINT run_events_session_fk
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE SET NULL;

-- 3. Add timestamps where missing.
ALTER TABLE cron_jobs
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- 4. Drop duplicate token hash index (UNIQUE on token_hash already enforces uniqueness).
DROP INDEX IF EXISTS api_tokens_hash_idx;

-- 5. Enforce known enum-like values (must match runtime writers).
ALTER TABLE messages
  ADD CONSTRAINT messages_role_check
  CHECK (role IN ('user', 'assistant', 'system', 'tool'));

ALTER TABLE cron_runs
  ADD CONSTRAINT cron_runs_status_check
  CHECK (status IN ('running', 'completed', 'failed'));

ALTER TABLE mcp_servers
  ADD CONSTRAINT mcp_servers_transport_check
  CHECK (transport IN ('stdio', 'http'));

-- 6. Enforce event replay uniqueness.
DROP INDEX IF EXISTS run_events_run_seq_idx;
CREATE UNIQUE INDEX run_events_run_seq_key ON run_events (run_id, seq);

-- Keep messages_embedding_hnsw (message vector search still planned).

ANALYZE sessions;
ANALYZE profiles;
ANALYZE messages;
ANALYZE memory;
ANALYZE mcp_servers;
ANALYZE cron_jobs;
ANALYZE cron_runs;
ANALYZE run_events;
