-- Open Jarvis — skills sync identity + retrieval columns
-- Depends on 0001–0006. Do not alter cron 0005 workflow.
-- Plain statements only (no DO $$ blocks) for the migrate runner.

-- Sync identity / change detection
ALTER TABLE skills
  ADD COLUMN IF NOT EXISTS slug TEXT,
  ADD COLUMN IF NOT EXISTS content_hash TEXT,
  ADD COLUMN IF NOT EXISTS enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS missing_on_disk BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS metadata JSONB;

-- Backfill slug from name (normalize to kebab-case)
UPDATE skills
SET slug = lower(regexp_replace(trim(both '-' FROM regexp_replace(name, '[^a-zA-Z0-9]+', '-', 'g')), '-+', '-', 'g'))
WHERE slug IS NULL OR slug = '';

UPDATE skills
SET slug = 'skill-' || substr(replace(id::text, '-', ''), 1, 8)
WHERE slug IS NULL OR slug = '';

-- Disambiguate duplicate slugs before unique index
UPDATE skills s
SET slug = s.slug || '-' || substr(replace(s.id::text, '-', ''), 1, 8)
WHERE EXISTS (
  SELECT 1 FROM skills o
  WHERE o.slug = s.slug AND o.id < s.id
);

ALTER TABLE skills
  ALTER COLUMN slug SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS skills_slug_key ON skills (slug);

-- Path is the on-disk identity when present
CREATE UNIQUE INDEX IF NOT EXISTS skills_path_key
  ON skills (path)
  WHERE path IS NOT NULL;

-- Hot filters
CREATE INDEX IF NOT EXISTS skills_enabled_idx ON skills (enabled);
CREATE INDEX IF NOT EXISTS skills_missing_on_disk_idx ON skills (missing_on_disk);
CREATE INDEX IF NOT EXISTS skills_source_idx ON skills (source);
CREATE INDEX IF NOT EXISTS skills_last_synced_at_idx ON skills (last_synced_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS skills_updated_at_idx ON skills (updated_at DESC);

-- Keyword retrieval (name + description + body)
ALTER TABLE skills
  ADD COLUMN IF NOT EXISTS search TSVECTOR
  GENERATED ALWAYS AS (
    to_tsvector(
      'english',
      coalesce(name, '') || ' ' || coalesce(description, '') || ' ' || coalesce(body_md, '')
    )
  ) STORED;

CREATE INDEX IF NOT EXISTS skills_search_gin ON skills USING GIN (search);

-- HNSW already exists from 0001 (skills_embedding_hnsw); keep it.

ANALYZE skills;
