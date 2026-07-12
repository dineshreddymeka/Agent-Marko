-- Postgres-only Jarvis recall indexer.

CREATE TABLE IF NOT EXISTS jarvis_index_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  path TEXT,
  title TEXT,
  content_hash TEXT,
  mime_type TEXT,
  size_bytes INT,
  mtime TIMESTAMPTZ,
  session_id UUID,
  run_id UUID,
  user_id TEXT,
  action_id UUID,
  tags JSONB NOT NULL DEFAULT '[]'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source_type, source_id)
);

CREATE TABLE IF NOT EXISTS jarvis_index_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES jarvis_index_documents(id) ON DELETE CASCADE,
  chunk_index INT NOT NULL,
  content TEXT NOT NULL,
  search TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', coalesce(content, ''))) STORED,
  embedding vector(1536),
  token_estimate INT NOT NULL DEFAULT 0,
  line_start INT,
  line_end INT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (document_id, chunk_index)
);

CREATE TABLE IF NOT EXISTS jarvis_index_actions (
  action_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID,
  run_id UUID,
  user_id TEXT,
  parent_action_id UUID REFERENCES jarvis_index_actions(action_id) ON DELETE SET NULL,
  source_type TEXT NOT NULL,
  source_id TEXT,
  action_type TEXT NOT NULL,
  summary TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS jarvis_index_action_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action_id UUID NOT NULL REFERENCES jarvis_index_actions(action_id) ON DELETE CASCADE,
  document_id UUID REFERENCES jarvis_index_documents(id) ON DELETE CASCADE,
  chunk_id UUID REFERENCES jarvis_index_chunks(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  relation TEXT NOT NULL DEFAULT 'touched',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS index_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  action_id UUID,
  session_id UUID,
  run_id UUID,
  user_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  priority INT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INT NOT NULL DEFAULT 0,
  last_error TEXT,
  locked_at TIMESTAMPTZ,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS jarvis_index_documents_source_idx
  ON jarvis_index_documents (source_type, source_id);
CREATE INDEX IF NOT EXISTS jarvis_index_documents_path_idx
  ON jarvis_index_documents (path text_pattern_ops) WHERE path IS NOT NULL;
CREATE INDEX IF NOT EXISTS jarvis_index_documents_session_idx
  ON jarvis_index_documents (session_id, updated_at DESC) WHERE session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS jarvis_index_documents_run_idx
  ON jarvis_index_documents (run_id, updated_at DESC) WHERE run_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS jarvis_index_documents_user_idx
  ON jarvis_index_documents (user_id, updated_at DESC) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS jarvis_index_documents_action_idx
  ON jarvis_index_documents (action_id, updated_at DESC) WHERE action_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS jarvis_index_documents_mtime_idx
  ON jarvis_index_documents (mtime DESC) WHERE mtime IS NOT NULL;
CREATE INDEX IF NOT EXISTS jarvis_index_documents_tags_gin
  ON jarvis_index_documents USING GIN (tags);
CREATE INDEX IF NOT EXISTS jarvis_index_documents_metadata_gin
  ON jarvis_index_documents USING GIN (metadata);

CREATE INDEX IF NOT EXISTS jarvis_index_chunks_search_gin
  ON jarvis_index_chunks USING GIN (search);
CREATE INDEX IF NOT EXISTS jarvis_index_chunks_embedding_hnsw
  ON jarvis_index_chunks USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE INDEX IF NOT EXISTS jarvis_index_actions_session_idx
  ON jarvis_index_actions (session_id, created_at DESC) WHERE session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS jarvis_index_actions_run_idx
  ON jarvis_index_actions (run_id, created_at DESC) WHERE run_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS jarvis_index_actions_user_idx
  ON jarvis_index_actions (user_id, created_at DESC) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS jarvis_index_actions_parent_idx
  ON jarvis_index_actions (parent_action_id) WHERE parent_action_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS jarvis_index_actions_source_idx
  ON jarvis_index_actions (source_type, source_id);
CREATE INDEX IF NOT EXISTS jarvis_index_action_links_action_idx
  ON jarvis_index_action_links (action_id);
CREATE INDEX IF NOT EXISTS jarvis_index_action_links_target_idx
  ON jarvis_index_action_links (target_type, target_id);

CREATE INDEX IF NOT EXISTS index_jobs_claim_idx
  ON index_jobs (status, next_attempt_at ASC, priority DESC, created_at ASC);
CREATE INDEX IF NOT EXISTS index_jobs_source_idx
  ON index_jobs (source_type, source_id, status);
CREATE INDEX IF NOT EXISTS index_jobs_action_idx
  ON index_jobs (action_id) WHERE action_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS index_jobs_retry_idx
  ON index_jobs (next_attempt_at ASC) WHERE status = 'pending';

ANALYZE jarvis_index_documents;
ANALYZE jarvis_index_chunks;
ANALYZE jarvis_index_actions;
ANALYZE jarvis_index_action_links;
ANALYZE index_jobs;
