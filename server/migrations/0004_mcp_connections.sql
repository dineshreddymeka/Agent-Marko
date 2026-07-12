-- Open Jarvis — MCP Connections storage for enterprise Settings UI
-- Author: Dinesh Reddy Meka
-- Extends mcp_servers for workflow status, discovery cache, connectivity options.
-- Adds mcp_connection_events for connect/disconnect/error audit trail.

ALTER TABLE mcp_servers
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS http_prefer_sse BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS timeout_ms INTEGER,
  ADD COLUMN IF NOT EXISTS auto_reconnect BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS last_status TEXT,
  ADD COLUMN IF NOT EXISTS last_error TEXT,
  ADD COLUMN IF NOT EXISTS last_connected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_tested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS discovered_tools JSONB,
  ADD COLUMN IF NOT EXISTS discovered_resources JSONB,
  ADD COLUMN IF NOT EXISTS discovered_prompts JSONB,
  ADD COLUMN IF NOT EXISTS metadata JSONB;

CREATE INDEX IF NOT EXISTS idx_mcp_servers_enabled ON mcp_servers (enabled);
CREATE INDEX IF NOT EXISTS idx_mcp_servers_last_status ON mcp_servers (last_status);
CREATE INDEX IF NOT EXISTS idx_mcp_servers_updated_at ON mcp_servers (updated_at DESC);

CREATE TABLE IF NOT EXISTS mcp_connection_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id UUID NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  status TEXT,
  transport_kind TEXT,
  detail JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mcp_connection_events_server_created
  ON mcp_connection_events (server_id, created_at DESC);
