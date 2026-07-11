import {
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'

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
  sourceSession: uuid('source_session'),
  userId: text('user_id'),
  importance: real('importance').notNull().default(0.5),
  embedding: vector('embedding'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastAccessed: timestamp('last_accessed', { withTimezone: true }),
})

export const skills = pgTable('skills', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().unique(),
  description: text('description'),
  bodyMd: text('body_md').notNull().default(''),
  source: text('source').notNull().default('user-folder'),
  path: text('path'),
  triggers: jsonb('triggers'),
  usageCount: integer('usage_count').notNull().default(0),
  successCount: integer('success_count').notNull().default(0),
  embedding: vector('embedding'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const mcpServers = pgTable('mcp_servers', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().unique(),
  transport: text('transport').notNull(),
  command: text('command'),
  url: text('url'),
  env: jsonb('env'),
  headers: jsonb('headers'),
  enabled: boolean('enabled').notNull().default(true),
  toolWhitelist: jsonb('tool_whitelist'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const cronJobs = pgTable('cron_jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  schedule: text('schedule').notNull(),
  prompt: text('prompt').notNull(),
  profileId: uuid('profile_id'),
  enabled: boolean('enabled').notNull().default(true),
  lastRun: timestamp('last_run', { withTimezone: true }),
  nextRun: timestamp('next_run', { withTimezone: true }),
})

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
})

export const profiles = pgTable('profiles', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  systemPrompt: text('system_prompt').notNull().default('You are Hermes, a helpful AI assistant.'),
  model: text('model').notNull().default('gpt-4o-mini'),
  temperature: real('temperature').notNull().default(0.7),
  provider: text('provider').notNull().default('native'),
  providerConfig: jsonb('provider_config'),
  settings: jsonb('settings'),
})

export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
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
  (t) => [index('run_events_run_seq_idx').on(t.runId, t.seq)],
)

export const schema = {
  sessions,
  messages,
  memory,
  skills,
  mcpServers,
  cronJobs,
  cronRuns,
  profiles,
  settings,
  runEvents,
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
