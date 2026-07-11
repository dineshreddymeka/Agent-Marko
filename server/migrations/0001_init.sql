-- Hermes UI initial schema (Postgres 18 + pgvector)
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL DEFAULT 'New chat',
  group_name TEXT,
  profile_id UUID,
  user_id TEXT,
  pinned BOOLEAN NOT NULL DEFAULT FALSE,
  archived BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  system_prompt TEXT NOT NULL DEFAULT 'You are Hermes, a helpful AI assistant.',
  model TEXT NOT NULL DEFAULT 'gpt-4o-mini',
  temperature REAL NOT NULL DEFAULT 0.7,
  provider TEXT NOT NULL DEFAULT 'native',
  provider_config JSONB,
  settings JSONB
);

CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  run_id UUID,
  role TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  tool_name TEXT,
  tool_args JSONB,
  tool_result JSONB,
  thinking TEXT,
  a2ui JSONB,
  tokens INT,
  embedding vector(1536),
  search TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', coalesce(content, ''))) STORED,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind TEXT NOT NULL,
  content TEXT NOT NULL,
  source_session UUID,
  user_id TEXT,
  importance REAL NOT NULL DEFAULT 0.5,
  embedding vector(1536),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_accessed TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS skills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  body_md TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'user-folder',
  path TEXT,
  triggers JSONB,
  usage_count INT NOT NULL DEFAULT 0,
  success_count INT NOT NULL DEFAULT 0,
  embedding vector(1536),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS mcp_servers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  transport TEXT NOT NULL,
  command TEXT,
  url TEXT,
  env JSONB,
  headers JSONB,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  tool_whitelist JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cron_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  schedule TEXT NOT NULL,
  prompt TEXT NOT NULL,
  profile_id UUID,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  last_run TIMESTAMPTZ,
  next_run TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS cron_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES cron_jobs(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'running',
  session_id UUID,
  error TEXT
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS run_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL,
  session_id UUID,
  seq INT NOT NULL,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS messages_search_gin ON messages USING GIN (search);
CREATE INDEX IF NOT EXISTS messages_session_created_idx ON messages (session_id, created_at);
CREATE INDEX IF NOT EXISTS sessions_updated_at_idx ON sessions (updated_at DESC);

CREATE INDEX IF NOT EXISTS messages_embedding_hnsw
  ON messages USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE INDEX IF NOT EXISTS memory_embedding_hnsw
  ON memory USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE INDEX IF NOT EXISTS skills_embedding_hnsw
  ON skills USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE INDEX IF NOT EXISTS run_events_run_seq_idx ON run_events (run_id, seq);

-- Default profile
INSERT INTO profiles (id, name, system_prompt, model, temperature, provider)
SELECT gen_random_uuid(), 'Default', 'You are Hermes, a helpful AI assistant.', 'gpt-4o-mini', 0.7, 'native'
WHERE NOT EXISTS (SELECT 1 FROM profiles LIMIT 1);
