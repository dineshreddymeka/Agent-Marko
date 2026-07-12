import {
  boolean,
  customType,
  index,
  integer,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

/**
 * Bun.sql already serializes JS objects for jsonb params.
 * Drizzle's built-in `jsonb()` also JSON.stringify's → values land as
 * jsonb *strings* (`jsonb_typeof = 'string'`), breaking `->` / restore.
 * @see https://github.com/drizzle-team/drizzle-orm/issues/4385
 */
const jsonb = customType<{ data: unknown; driverData: unknown }>({
  dataType() {
    return 'jsonb'
  },
  toDriver(value: unknown) {
    return value
  },
  fromDriver(value: unknown) {
    // Unwrap legacy double-encoded rows until migration 0010 rewrites them.
    if (typeof value === 'string') {
      try {
        return JSON.parse(value) as unknown
      } catch {
        return value
      }
    }
    return value
  },
})

const vector = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return 'vector'
  },
  toDriver(value: number[]) {
    return `[${value.join(',')}]`
  },
  fromDriver(value: string) {
    return value
      .slice(1, -1)
      .split(',')
      .map((v) => Number(v.trim()))
  },
})

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    title: text('title').notNull().default('New chat'),
    groupName: text('group_name'),
    profileId: uuid('profile_id'),
    userId: text('user_id'),
    pinned: boolean('pinned').notNull().default(false),
    archived: boolean('archived').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('sessions_updated_at_idx').on(t.updatedAt)],
)

export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    runId: uuid('run_id'),
    role: text('role').notNull(),
    content: text('content').notNull().default(''),
    toolName: text('tool_name'),
    toolArgs: jsonb('tool_args'),
    toolResult: jsonb('tool_result'),
    thinking: text('thinking'),
    a2ui: jsonb('a2ui'),
    tokens: integer('tokens'),
    embedding: vector('embedding'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('messages_session_created_idx').on(t.sessionId, t.createdAt)],
)

export const memory = pgTable('memory', {
  id: uuid('id').primaryKey().defaultRandom(),
  kind: text('kind').notNull(),
  content: text('content').notNull(),
  /** Session provenance (insert-contract session_id). Historical column name. */
  sourceSession: uuid('source_session'),
  userId: text('user_id'),
  importance: real('importance').notNull().default(0.5),
  embedding: vector('embedding'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastAccessed: timestamp('last_accessed', { withTimezone: true }),
})

export const skills = pgTable(
  'skills',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull().unique(),
    /** Stable sync identity (kebab-case); unique. */
    slug: text('slug').notNull().unique(),
    description: text('description'),
    bodyMd: text('body_md').notNull().default(''),
    source: text('source').notNull().default('user-folder'),
    path: text('path'),
    /** SHA-256 of body_md for change detection during sync. */
    contentHash: text('content_hash'),
    triggers: jsonb('triggers'),
    enabled: boolean('enabled').notNull().default(true),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    missingOnDisk: boolean('missing_on_disk').notNull().default(false),
    /** Escape hatch for non-filter metadata only. */
    metadata: jsonb('metadata'),
    usageCount: integer('usage_count').notNull().default(0),
    successCount: integer('success_count').notNull().default(0),
    embedding: vector('embedding'),
    /** Nullable — skills are global; set when learned/created in a session. */
    sessionId: uuid('session_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('skills_enabled_idx').on(t.enabled),
    index('skills_missing_on_disk_idx').on(t.missingOnDisk),
    index('skills_source_idx').on(t.source),
    index('skills_updated_at_idx').on(t.updatedAt),
  ],
)

export const mcpServers = pgTable('mcp_servers', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().unique(),
  description: text('description'),
  transport: text('transport').notNull(),
  command: text('command'),
  url: text('url'),
  env: jsonb('env'),
  headers: jsonb('headers'),
  enabled: boolean('enabled').notNull().default(true),
  toolWhitelist: jsonb('tool_whitelist'),
  httpPreferSse: boolean('http_prefer_sse').notNull().default(false),
  timeoutMs: integer('timeout_ms'),
  autoReconnect: boolean('auto_reconnect').notNull().default(true),
  lastStatus: text('last_status'),
  lastError: text('last_error'),
  lastConnectedAt: timestamp('last_connected_at', { withTimezone: true }),
  lastTestedAt: timestamp('last_tested_at', { withTimezone: true }),
  discoveredTools: jsonb('discovered_tools'),
  discoveredResources: jsonb('discovered_resources'),
  discoveredPrompts: jsonb('discovered_prompts'),
  metadata: jsonb('metadata'),
  /** Nullable — MCP registry is global. */
  sessionId: uuid('session_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const mcpConnectionEvents = pgTable('mcp_connection_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  serverId: uuid('server_id')
    .notNull()
    .references(() => mcpServers.id, { onDelete: 'cascade' }),
  eventType: text('event_type').notNull(),
  status: text('status'),
  transportKind: text('transport_kind'),
  detail: jsonb('detail'),
  /** Nullable — set when connect/test is session-triggered. */
  sessionId: uuid('session_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const cronJobs = pgTable(
  'cron_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    schedule: text('schedule').notNull(),
    prompt: text('prompt').notNull(),
    profileId: uuid('profile_id'),
    enabled: boolean('enabled').notNull().default(true),
    lastRun: timestamp('last_run', { withTimezone: true }),
    nextRun: timestamp('next_run', { withTimezone: true }),
    timezone: text('timezone').notNull().default('UTC'),
    /** Wizard answers + bindings (CronWorkflow shape, zod-validated at REST). */
    workflow: jsonb('workflow').notNull().default({}),
    /** Denormalized from workflow.mcpServerIds — GIN-indexed for fast filters. */
    mcpServerIds: uuid('mcp_server_ids').array().notNull().default([]),
    /** Denormalized from workflow.skillIds — GIN-indexed for fast filters. */
    skillIds: uuid('skill_ids').array().notNull().default([]),
    /** Nullable — cron definitions are global; set when created from a session. */
    sessionId: uuid('session_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('cron_jobs_mcp_server_ids_gin').using('gin', t.mcpServerIds),
    index('cron_jobs_skill_ids_gin').using('gin', t.skillIds),
  ],
)

export const cronRuns = pgTable('cron_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  jobId: uuid('job_id')
    .notNull()
    .references(() => cronJobs.id, { onDelete: 'cascade' }),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  status: text('status').notNull().default('running'),
  sessionId: uuid('session_id'),
  error: text('error'),
  /** Per-run binding snapshot: { mcpAllowed, skillsForced, attempts, errorCode }. */
  detail: jsonb('detail'),
})

export const profiles = pgTable('profiles', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  systemPrompt: text('system_prompt').notNull().default('You are Open Jarvis, a helpful AI assistant.'),
  model: text('model').notNull().default('gpt-4o-mini'),
  temperature: real('temperature').notNull().default(0.7),
  provider: text('provider').notNull().default('native'),
  providerConfig: jsonb('provider_config'),
  settings: jsonb('settings'),
  /** Nullable — profiles are global. */
  sessionId: uuid('session_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  /** Nullable — settings are global app config. */
  sessionId: uuid('session_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const apiTokens = pgTable('api_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id'),
  name: text('name').notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  tokenPrefix: text('token_prefix').notNull(),
  scopes: jsonb('scopes').notNull().default([]),
  lastUsed: timestamp('last_used', { withTimezone: true }),
  /** Nullable — tokens are global credentials. */
  sessionId: uuid('session_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const runEvents = pgTable(
  'run_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    runId: uuid('run_id').notNull(),
    sessionId: uuid('session_id'),
    seq: integer('seq').notNull(),
    eventType: text('event_type').notNull(),
    payload: jsonb('payload').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('run_events_run_seq_key').on(t.runId, t.seq)],
)

export const jarvisIndexDocuments = pgTable(
  'jarvis_index_documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceType: text('source_type').notNull(),
    sourceId: text('source_id').notNull(),
    path: text('path'),
    title: text('title'),
    contentHash: text('content_hash'),
    mimeType: text('mime_type'),
    sizeBytes: integer('size_bytes'),
    mtime: timestamp('mtime', { withTimezone: true }),
    sessionId: uuid('session_id'),
    runId: uuid('run_id'),
    userId: text('user_id'),
    actionId: uuid('action_id'),
    tags: jsonb('tags').notNull().default([]),
    metadata: jsonb('metadata').notNull().default({}),
    chunkCount: integer('chunk_count').notNull().default(0),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('jarvis_index_documents_source_key').on(t.sourceType, t.sourceId),
    index('jarvis_index_documents_session_idx').on(t.sessionId, t.updatedAt),
    index('jarvis_index_documents_run_idx').on(t.runId, t.updatedAt),
    index('jarvis_index_documents_user_idx').on(t.userId, t.updatedAt),
    index('jarvis_index_documents_action_idx').on(t.actionId, t.updatedAt),
  ],
)

export const jarvisIndexChunks = pgTable(
  'jarvis_index_chunks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => jarvisIndexDocuments.id, { onDelete: 'cascade' }),
    chunkIndex: integer('chunk_index').notNull(),
    content: text('content').notNull(),
    embedding: vector('embedding'),
    tokenEstimate: integer('token_estimate').notNull().default(0),
    lineStart: integer('line_start'),
    lineEnd: integer('line_end'),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('jarvis_index_chunks_doc_chunk_key').on(t.documentId, t.chunkIndex)],
)

export const jarvisIndexActions = pgTable(
  'jarvis_index_actions',
  {
    actionId: uuid('action_id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id'),
    runId: uuid('run_id'),
    userId: text('user_id'),
    parentActionId: uuid('parent_action_id'),
    sourceType: text('source_type').notNull(),
    sourceId: text('source_id'),
    actionType: text('action_type').notNull(),
    summary: text('summary'),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('jarvis_index_actions_session_idx').on(t.sessionId, t.createdAt),
    index('jarvis_index_actions_run_idx').on(t.runId, t.createdAt),
    index('jarvis_index_actions_user_idx').on(t.userId, t.createdAt),
    index('jarvis_index_actions_parent_idx').on(t.parentActionId),
    index('jarvis_index_actions_source_idx').on(t.sourceType, t.sourceId),
  ],
)

export const jarvisIndexActionLinks = pgTable(
  'jarvis_index_action_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actionId: uuid('action_id')
      .notNull()
      .references(() => jarvisIndexActions.actionId, { onDelete: 'cascade' }),
    documentId: uuid('document_id').references(() => jarvisIndexDocuments.id, { onDelete: 'cascade' }),
    chunkId: uuid('chunk_id').references(() => jarvisIndexChunks.id, { onDelete: 'cascade' }),
    targetType: text('target_type').notNull(),
    targetId: text('target_id').notNull(),
    relation: text('relation').notNull().default('touched'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('jarvis_index_action_links_action_idx').on(t.actionId),
    index('jarvis_index_action_links_target_idx').on(t.targetType, t.targetId),
  ],
)

export const indexJobs = pgTable(
  'index_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceType: text('source_type').notNull(),
    sourceId: text('source_id').notNull(),
    operation: text('operation').notNull(),
    actionId: uuid('action_id'),
    sessionId: uuid('session_id'),
    runId: uuid('run_id'),
    userId: text('user_id'),
    metadata: jsonb('metadata').notNull().default({}),
    priority: integer('priority').notNull().default(0),
    status: text('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    lockToken: uuid('lock_token'),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
    rerunRequested: boolean('rerun_requested').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('index_jobs_claim_idx').on(t.status, t.nextAttemptAt, t.priority, t.createdAt),
    index('index_jobs_source_idx').on(t.sourceType, t.sourceId, t.status),
    index('index_jobs_action_idx').on(t.actionId),
    index('index_jobs_retry_idx').on(t.nextAttemptAt),
  ],
)

export const schema = {
  sessions,
  messages,
  memory,
  skills,
  mcpServers,
  mcpConnectionEvents,
  cronJobs,
  cronRuns,
  profiles,
  settings,
  apiTokens,
  runEvents,
  jarvisIndexDocuments,
  jarvisIndexChunks,
  jarvisIndexActions,
  jarvisIndexActionLinks,
  indexJobs,
}

export type SessionRow = typeof sessions.$inferSelect
export type MessageRow = typeof messages.$inferSelect
export type MemoryRow = typeof memory.$inferSelect
export type SkillRow = typeof skills.$inferSelect
export type McpServerRow = typeof mcpServers.$inferSelect
export type CronJobRow = typeof cronJobs.$inferSelect
export type CronRunRow = typeof cronRuns.$inferSelect
export type ProfileRow = typeof profiles.$inferSelect
export type RunEventRow = typeof runEvents.$inferSelect
export type ApiTokenRow = typeof apiTokens.$inferSelect
export type JarvisIndexDocumentRow = typeof jarvisIndexDocuments.$inferSelect
export type JarvisIndexChunkRow = typeof jarvisIndexChunks.$inferSelect
export type JarvisIndexActionRow = typeof jarvisIndexActions.$inferSelect
export type JarvisIndexActionLinkRow = typeof jarvisIndexActionLinks.$inferSelect
export type IndexJobRow = typeof indexJobs.$inferSelect
