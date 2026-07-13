import { z } from 'zod'
import { resolve } from 'node:path'
import {
  repoRoot,
  resolveBackupDir,
  resolveCoworkWorkspace,
  resolveHermesDataDir,
  resolveWorkspaceRoot,
} from './paths'

function envBool(defaultValue = false) {
  return z.preprocess((value) => {
    if (value === undefined || value === '') return defaultValue
    if (typeof value === 'boolean') return value
    const normalized = String(value).trim().toLowerCase()
    if (['0', 'false', 'no', 'off', ''].includes(normalized)) return false
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
    return defaultValue
  }, z.boolean())
}

/** Resolve relative paths against the monorepo root (dev-only relative overrides). */
function resolveFromRepoRoot(p: string): string {
  return resolve(repoRoot(), p)
}

const envSchema = z.object({
  DATABASE_URL: z.string().default('postgres://hermes:hermes@localhost:5433/hermes'),
  /** Host data root — workspace, backups, and cowork dirs derive from here when unset. */
  HERMES_DATA_DIR: z.string().default(''),
  HERMES_BACKUP_DIR: z.string().default(''),
  /**
   * Bun.sql pool size; keep well below Postgres max_connections (50 in compose).
   * Default 5 leaves headroom for hot-reload leftovers, psql, and parallel agents.
   */
  HERMES_DB_POOL_MAX: z.coerce.number().int().min(1).max(40).default(5),
  HERMES_BACKUP_KEEP: z.coerce.number().int().min(1).max(10_000).default(10),
  /** Days to retain `run_events` rows before prune (ops script / retention). */
  HERMES_EVENT_RETENTION_DAYS: z.coerce.number().int().min(1).max(3650).default(30),
  /** Days to retain `mcp_connection_events` rows before prune. */
  HERMES_MCP_EVENT_RETENTION_DAYS: z.coerce.number().int().min(1).max(3650).default(30),
  LLM_BASE_URL: z.string().default('https://api.openai.com/v1'),
  LLM_API_KEY: z.string().default(''),
  /**
   * Preferred OpenAI-compatible base URL for agent runs with tool_calls.
   * When unset and LLM_BASE_URL is the chat-only lm-bridge (:3456), tools degrade.
   */
  HERMES_AGENT_LLM_URL: z.string().default(''),
  /** Optional dedicated embeddings base URL (defaults to HERMES_AGENT_LLM_URL or LLM_BASE_URL). */
  HERMES_EMBEDDINGS_URL: z.string().default(''),
  /** Operator rollback: `legacy` keeps regex tool subsetting; `capabilities` is default. */
  HERMES_ROUTING: z.enum(['legacy', 'capabilities']).default('capabilities'),
  /** Bounded connect/first-byte timeout when probing the agent LLM. */
  HERMES_AGENT_LLM_TIMEOUT_MS: z.coerce.number().int().min(500).max(60_000).default(5_000),
  EMBEDDINGS_MODEL: z.string().default('text-embedding-3-small'),
  EMBEDDING_DIMENSION: z.coerce.number().default(1536),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  DEBUG_LLM: envBool(false),
  ALLOW_SIGNUP: envBool(false),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().default(3001),
  /** Fleet: public browser origin (defaults to BETTER_AUTH_URL). Used for CORS + auth cookies. */
  HERMES_PUBLIC_URL: z.string().default(''),
  /** Fleet: serve `app/dist` from the API port (no separate Vite dev server). */
  HERMES_SERVE_STATIC: envBool(false),
  /** Comma-separated extra CORS origins (e.g. https://jarvis.corp.com). */
  CORS_ORIGINS: z.string().default(''),
  /** Empty = `${HERMES_DATA_DIR}/workspace` (set per host in fleet deploy). */
  WORKSPACE_ROOT: z.string().default(''),
  BETTER_AUTH_SECRET: z.string().default('dev-secret-change-in-production'),
  BETTER_AUTH_URL: z.string().default('http://127.0.0.1:3001'),
  /** OAuth (optional) — when set, better-auth socialProviders activate */
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  /** Microsoft Graph OAuth for Office briefing. */
  MICROSOFT_CLIENT_ID: z.string().optional(),
  MICROSOFT_CLIENT_SECRET: z.string().optional(),
  MICROSOFT_TENANT_ID: z.string().default('organizations'),
  MICROSOFT_REDIRECT_URI: z.string().optional(),
  /** When true, Office Briefing auto-redirects to Microsoft SSO if not connected. */
  MICROSOFT_SSO_AUTO: envBool(true),
  HERMES_PYTHON_URL: z.string().optional(),
  /** Optional auth header for hermes-python bridge */
  HERMES_PYTHON_AUTH: z.string().optional(),
  SKILLS_DIR: z.string().default('./skills'),
  AUTO_APPROVE_ALL: envBool(false),
  CONTEXT_TOKEN_LIMIT: z.coerce.number().default(128_000),
  CONTEXT_INJECTION_BUDGET: z.coerce.number().default(8000),
  COMPUTE_POOL_SIZE: z.coerce.number().default(2),
  WEB_SEARCH_PROVIDER: z
    .enum(['auto', 'google', 'brave', 'tavily', 'serper', 'duckduckgo'])
    .default('auto'),
  WEB_SEARCH_API_KEY: z.string().optional(),
  /** Google Programmable Search engine id (cx) — required for WEB_SEARCH_PROVIDER=google. */
  WEB_SEARCH_GOOGLE_CX: z.string().default(''),
  RUN_CODE_TIMEOUT_MS: z.coerce.number().default(30_000),
  ENABLE_TOTP: envBool(false),
  /** Active Directory / OpenLDAP sign-in (fleet deploy). */
  LDAP_ENABLED: envBool(false),
  LDAP_URL: z.string().default(''),
  /** Service account DN for user search (optional for some simple binds). */
  LDAP_BIND_DN: z.string().default(''),
  LDAP_BIND_PASSWORD: z.string().default(''),
  LDAP_BASE_DN: z.string().default(''),
  /** AD: sAMAccountName or userPrincipalName; OpenLDAP: uid */
  LDAP_USER_ATTRIBUTE: z.string().default('sAMAccountName'),
  /** Fallback email domain when LDAP has no mail attribute (e.g. corp.example.com). */
  LDAP_EMAIL_DOMAIN: z.string().default(''),
  LDAP_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60_000).default(8_000),
  /** Set false only for dev LDAPS with self-signed certs. */
  LDAP_TLS_REJECT_UNAUTHORIZED: envBool(true),
  /**
   * Open Cowork packaged Electron exe (headless stdio worker).
   * Empty = resolve at runtime via OPEN_COWORK_PATH / COWORK_EXE / Windows default candidate.
   * Do not invent a machine-specific path here — missing exe is reported by /api/cowork/setup.
   */
  OPEN_COWORK_EXE: z.string().default(''),
  /** Empty = `${HERMES_DATA_DIR}/cowork-workspace`. */
  OPEN_COWORK_WORKSPACE: z.string().default(''),
  /** Pass --auto-approve to headless Cowork (trusted sandboxed tasks only). */
  OPEN_COWORK_AUTO_APPROVE: envBool(true),
  /** Per-task timeout for CoworkClient.runTask (default 15 minutes). */
  OPEN_COWORK_TIMEOUT_MS: z.coerce.number().int().min(1_000).default(15 * 60_000),
  /** Jarvis fast indexer master switch. */
  INDEXER_ENABLED: envBool(true),
  /** Boot-time workspace scan into index_jobs. */
  INDEXER_SCAN_ON_START: envBool(true),
  /** Optional fs.watch on WORKSPACE_ROOT. */
  INDEXER_WATCHER_ENABLED: envBool(true),
  /** Fallback poll interval when LISTEN/wake is quiet (ms). */
  INDEXER_POLL_MS: z.coerce.number().int().min(1_000).max(300_000).default(15_000),
  /** Max workspace/office file bytes to fully index as text. */
  INDEXER_MAX_FILE_BYTES: z.coerce.number().int().min(1_024).max(10 * 1024 * 1024).default(512 * 1024),
  /** Chunk size in characters for text splitting. */
  INDEXER_CHUNK_CHARS: z.coerce.number().int().min(256).max(16_000).default(1800),
  /** Overlap between consecutive chunks (characters). */
  INDEXER_CHUNK_OVERLAP: z.coerce.number().int().min(0).max(4_000).default(200),
  /** Max jobs claimed per drain tick (FOR UPDATE SKIP LOCKED). */
  INDEXER_CLAIM_LIMIT: z.coerce.number().int().min(1).max(128).default(16),
  /** Parallel job processors within a claim batch. */
  INDEXER_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(4),
  /** Comma-separated path segments/globs to ignore (in addition to built-ins). */
  INDEXER_EXCLUDE_GLOBS: z.string().default(''),
  /** Default topK for automatic agent recall. */
  INDEXER_DEFAULT_TOP_K: z.coerce.number().int().min(1).max(50).default(8),
  /** Days before soft-deleted index docs / done jobs are pruned. */
  INDEXER_PRUNE_DAYS: z.coerce.number().int().min(1).max(3650).default(30),
  CLEANUP_ENABLED: envBool(true),
  CLEANUP_INTERVAL_MS: z.coerce.number().default(3_600_000),
  CLEANUP_RUN_EVENT_RETENTION_DAYS: z.coerce.number().default(7),
  CLEANUP_ARCHIVED_SESSION_RETENTION_DAYS: z.coerce.number().default(30),
  CLEANUP_SANDBOX_RETENTION_MINUTES: z.coerce.number().default(60),
})

/** Chat-only lm-bridge / :3456 cannot run tool_calls. */
function isChatOnlyLlmBaseUrl(url: string): boolean {
  const normalized = url.replace(/\/$/, '')
  return /:3456(?:\/|$)/i.test(normalized) || /lm-bridge/i.test(normalized)
}

export type Env = z.infer<typeof envSchema>

export function loadConfig(): Env {
  const raw = envSchema.parse(process.env)
  let agentLlmUrl = (raw.HERMES_AGENT_LLM_URL || '').trim()
  const baseUrl = raw.LLM_BASE_URL.replace(/\/$/, '')
  const apiKey = (raw.LLM_API_KEY || '').trim()
  if (!agentLlmUrl && apiKey && apiKey !== 'mock' && !isChatOnlyLlmBaseUrl(baseUrl)) {
    agentLlmUrl = baseUrl
  }

  const dataDir = resolveHermesDataDir(raw.HERMES_DATA_DIR)
  const workspaceRoot = resolveWorkspaceRoot(raw.WORKSPACE_ROOT, dataDir)
  const backupDir = resolveBackupDir(raw.HERMES_BACKUP_DIR, dataDir)
  const coworkWorkspace = resolveCoworkWorkspace(raw.OPEN_COWORK_WORKSPACE, dataDir)
  const publicUrl = (raw.HERMES_PUBLIC_URL || '').trim() || raw.BETTER_AUTH_URL

  return {
    ...raw,
    HERMES_AGENT_LLM_URL: agentLlmUrl,
    HERMES_DATA_DIR: dataDir,
    HERMES_BACKUP_DIR: backupDir,
    HERMES_PUBLIC_URL: publicUrl,
    WORKSPACE_ROOT: workspaceRoot,
    OPEN_COWORK_WORKSPACE: coworkWorkspace,
    SKILLS_DIR: resolveFromRepoRoot(raw.SKILLS_DIR),
  }
}

export const config = loadConfig()
