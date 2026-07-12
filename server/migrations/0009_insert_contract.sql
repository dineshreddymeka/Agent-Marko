-- Open Jarvis — insert contract: session_id + timestamps + jsonb discipline
-- Depends on 0001–0008.
-- Rules (docs/DATABASE-DESIGN.md § Insert contract):
--   * Session-scoped operational rows carry session_id (NOT NULL where already required).
--   * Global/config tables get nullable session_id (ON DELETE SET NULL).
--   * Every table has a date column (created_at / updated_at / started_at).
--   * Structured payloads stay jsonb (no text stringify).

-- 1. settings: dates + optional session provenance
ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS session_id UUID;

-- 2. Nullable session_id on global / config / audit-adjacent tables
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS session_id UUID;

ALTER TABLE skills
  ADD COLUMN IF NOT EXISTS session_id UUID;

ALTER TABLE mcp_servers
  ADD COLUMN IF NOT EXISTS session_id UUID;

ALTER TABLE mcp_connection_events
  ADD COLUMN IF NOT EXISTS session_id UUID;

ALTER TABLE cron_jobs
  ADD COLUMN IF NOT EXISTS session_id UUID;

ALTER TABLE api_tokens
  ADD COLUMN IF NOT EXISTS session_id UUID;

ALTER TABLE index_jobs
  ADD COLUMN IF NOT EXISTS session_id UUID;

-- 3. Pre-clean orphan session refs before FKs (tables that already had session_id).
UPDATE jarvis_index_documents d
SET session_id = NULL
WHERE session_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM sessions s WHERE s.id = d.session_id);

UPDATE jarvis_index_actions a
SET session_id = NULL
WHERE session_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM sessions s WHERE s.id = a.session_id);

-- 4. FKs (nullable, SET NULL on session delete).
ALTER TABLE settings
  ADD CONSTRAINT settings_session_fk
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE SET NULL;

ALTER TABLE profiles
  ADD CONSTRAINT profiles_session_fk
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE SET NULL;

ALTER TABLE skills
  ADD CONSTRAINT skills_session_fk
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE SET NULL;

ALTER TABLE mcp_servers
  ADD CONSTRAINT mcp_servers_session_fk
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE SET NULL;

ALTER TABLE mcp_connection_events
  ADD CONSTRAINT mcp_connection_events_session_fk
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE SET NULL;

ALTER TABLE cron_jobs
  ADD CONSTRAINT cron_jobs_session_fk
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE SET NULL;

ALTER TABLE api_tokens
  ADD CONSTRAINT api_tokens_session_fk
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE SET NULL;

ALTER TABLE index_jobs
  ADD CONSTRAINT index_jobs_session_fk
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE SET NULL;

ALTER TABLE jarvis_index_documents
  ADD CONSTRAINT jarvis_index_documents_session_fk
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE SET NULL;

ALTER TABLE jarvis_index_actions
  ADD CONSTRAINT jarvis_index_actions_session_fk
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE SET NULL;

-- 5. Partial indexes for session provenance lookups
CREATE INDEX IF NOT EXISTS settings_session_id_idx
  ON settings (session_id) WHERE session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS profiles_session_id_idx
  ON profiles (session_id) WHERE session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS skills_session_id_idx
  ON skills (session_id) WHERE session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS mcp_servers_session_id_idx
  ON mcp_servers (session_id) WHERE session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS mcp_connection_events_session_id_idx
  ON mcp_connection_events (session_id) WHERE session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS cron_jobs_session_id_idx
  ON cron_jobs (session_id) WHERE session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS api_tokens_session_id_idx
  ON api_tokens (session_id) WHERE session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS index_jobs_session_id_idx
  ON index_jobs (session_id) WHERE session_id IS NOT NULL;

ANALYZE settings;
ANALYZE profiles;
ANALYZE skills;
ANALYZE mcp_servers;
ANALYZE mcp_connection_events;
ANALYZE cron_jobs;
ANALYZE api_tokens;
ANALYZE index_jobs;
ANALYZE jarvis_index_documents;
ANALYZE jarvis_index_actions;
