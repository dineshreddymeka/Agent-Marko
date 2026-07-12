-- Fix drizzle-orm + Bun.sql jsonb double-encoding on run_events.payload.
-- Rows had jsonb_typeof(payload) = 'string' (JSON text wrapping an object),
-- which broke payload->>'taskId' and Cowork/AG-UI restore.

UPDATE run_events
SET payload = (payload #>> '{}')::jsonb
WHERE jsonb_typeof(payload) = 'string';

UPDATE settings
SET value = (value #>> '{}')::jsonb
WHERE jsonb_typeof(value) = 'string';

UPDATE messages
SET tool_args = (tool_args #>> '{}')::jsonb
WHERE tool_args IS NOT NULL AND jsonb_typeof(tool_args) = 'string';

UPDATE messages
SET tool_result = (tool_result #>> '{}')::jsonb
WHERE tool_result IS NOT NULL AND jsonb_typeof(tool_result) = 'string';

UPDATE messages
SET a2ui = (a2ui #>> '{}')::jsonb
WHERE a2ui IS NOT NULL AND jsonb_typeof(a2ui) = 'string';

UPDATE skills
SET triggers = (triggers #>> '{}')::jsonb
WHERE triggers IS NOT NULL AND jsonb_typeof(triggers) = 'string';

UPDATE cron_jobs
SET workflow = (workflow #>> '{}')::jsonb
WHERE jsonb_typeof(workflow) = 'string';

UPDATE cron_runs
SET detail = (detail #>> '{}')::jsonb
WHERE detail IS NOT NULL AND jsonb_typeof(detail) = 'string';

UPDATE profiles
SET provider_config = (provider_config #>> '{}')::jsonb
WHERE provider_config IS NOT NULL AND jsonb_typeof(provider_config) = 'string';

UPDATE profiles
SET settings = (settings #>> '{}')::jsonb
WHERE settings IS NOT NULL AND jsonb_typeof(settings) = 'string';

UPDATE api_tokens
SET scopes = (scopes #>> '{}')::jsonb
WHERE jsonb_typeof(scopes) = 'string';

ANALYZE run_events;
ANALYZE settings;
ANALYZE messages;
