-- Kanban task board (ported from hermes-agent kanban domain model)
-- Tasks have statuses matching the hermes-agent spec + parent/child deps + comments.

CREATE TABLE IF NOT EXISTS kanban_tasks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title       TEXT NOT NULL,
  body        TEXT,
  status      TEXT NOT NULL DEFAULT 'todo'
                CHECK (status IN ('triage','todo','ready','running','blocked','done','archived')),
  priority    INTEGER NOT NULL DEFAULT 0,
  assignee    TEXT,
  created_by  TEXT,
  block_kind  TEXT
                CHECK (block_kind IS NULL OR block_kind IN ('dependency','needs_input','capability','transient')),
  block_reason TEXT,
  result      TEXT,
  summary     TEXT,
  metadata    JSONB NOT NULL DEFAULT '{}',
  -- links to hermes-ui primitives
  session_id  UUID REFERENCES sessions(id) ON DELETE SET NULL,
  run_id      UUID,
  -- timestamps
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at  TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS kanban_tasks_status_idx ON kanban_tasks (status, priority DESC, created_at);
CREATE INDEX IF NOT EXISTS kanban_tasks_assignee_idx ON kanban_tasks (assignee, status);
CREATE INDEX IF NOT EXISTS kanban_tasks_session_idx ON kanban_tasks (session_id) WHERE session_id IS NOT NULL;

-- Parent-child dependency edges (child waits for parent to be 'done' before promoting to 'ready')
CREATE TABLE IF NOT EXISTS kanban_task_links (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id UUID NOT NULL REFERENCES kanban_tasks(id) ON DELETE CASCADE,
  child_id  UUID NOT NULL REFERENCES kanban_tasks(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (parent_id, child_id)
);

CREATE INDEX IF NOT EXISTS kanban_task_links_parent_idx ON kanban_task_links (parent_id);
CREATE INDEX IF NOT EXISTS kanban_task_links_child_idx ON kanban_task_links (child_id);

-- Comments thread per task (ported from hermes-agent task_comments)
CREATE TABLE IF NOT EXISTS kanban_task_comments (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id   UUID NOT NULL REFERENCES kanban_tasks(id) ON DELETE CASCADE,
  author    TEXT NOT NULL DEFAULT 'user',
  body      TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS kanban_task_comments_task_idx ON kanban_task_comments (task_id, created_at);
