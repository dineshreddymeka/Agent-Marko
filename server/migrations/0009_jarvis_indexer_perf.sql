-- Jarvis indexer speed: recent-time + hot-path partial indexes.

-- Ready-now pending jobs (claim path).
CREATE INDEX IF NOT EXISTS index_jobs_ready_partial_idx
  ON index_jobs (priority DESC, created_at ASC)
  WHERE status = 'pending';

-- Active documents only (search filters exclude deleted).
CREATE INDEX IF NOT EXISTS jarvis_index_documents_active_updated_idx
  ON jarvis_index_documents (updated_at DESC)
  WHERE deleted_at IS NULL;

-- Recent documents for recency-biased recall (30 days).
CREATE INDEX IF NOT EXISTS jarvis_index_documents_recent_mtime_idx
  ON jarvis_index_documents (mtime DESC)
  WHERE deleted_at IS NULL AND mtime IS NOT NULL;

CREATE INDEX IF NOT EXISTS jarvis_index_documents_recent_updated_idx
  ON jarvis_index_documents (updated_at DESC)
  WHERE deleted_at IS NULL;

-- Session + time for "what happened in this session recently".
CREATE INDEX IF NOT EXISTS jarvis_index_documents_session_recent_idx
  ON jarvis_index_documents (session_id, updated_at DESC)
  WHERE deleted_at IS NULL AND session_id IS NOT NULL;

-- Chunks that have embeddings (vector candidate path).
CREATE INDEX IF NOT EXISTS jarvis_index_chunks_embedded_doc_idx
  ON jarvis_index_chunks (document_id)
  WHERE embedding IS NOT NULL;

-- BRIN on action time for large history scans.
CREATE INDEX IF NOT EXISTS jarvis_index_actions_created_brin
  ON jarvis_index_actions USING BRIN (created_at);

ANALYZE index_jobs;
ANALYZE jarvis_index_documents;
ANALYZE jarvis_index_chunks;
ANALYZE jarvis_index_actions;
