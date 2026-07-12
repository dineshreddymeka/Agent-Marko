import { z } from 'zod'
import { isAbsolute, resolve } from 'node:path'

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

/** Resolve relative data paths against the monorepo root (not process cwd). */
function resolveFromRepoRoot(p: string): string {
  if (isAbsolute(p)) return p
  // server/src/config.ts → ../../ = hermes-ui/
  return resolve(import.meta.dir, '../..', p)
}

const envSchema = z.object({
  DATABASE_URL: z.string().default('postgres://hermes:hermes@localhost:5433/hermes'),
  HERMES_DATA_DIR: z.string().default('C:/hermes-data'),
  HERMES_BACKUP_DIR: z.string().default('C:/hermes-data/backups'),
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
  EMBEDDINGS_MODEL: z.string().default('text-embedding-3-small'),
  EMBEDDING_DIMENSION: z.coerce.number().default(1536),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  DEBUG_LLM: envBool(false),
  ALLOW_SIGNUP: envBool(false),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().default(3001),
  WORKSPACE_ROOT: z.string().default('./workspace'),
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
<<<<<<< HEAD
  COMPUTE_POOL_SIZE: z.coerce.number().default(2),
  WEB_SEARCH_PROVIDER: z.enum(['auto', 'brave', 'tavily', 'serper', 'duckduckgo']).default('auto'),
  WEB_SEARCH_API_KEY: z.string().optional(),
  RUN_CODE_TIMEOUT_MS: z.coerce.number().default(30_000),
  ENABLE_TOTP: envBool(false),
  /**
   * Open Cowork packaged Electron exe (headless stdio worker).
   * Empty = resolve at runtime via OPEN_COWORK_PATH / COWORK_EXE / Windows default candidate.
   * Do not invent a machine-specific path here — missing exe is reported by /api/cowork/setup.
   */
  OPEN_COWORK_EXE: z.string().default(''),
  /** Shared Open Cowork workspace (data plane: inbox/outbox/…). */
  OPEN_COWORK_WORKSPACE: z.string().default('C:/Users/dines/BMC/jarvis-cowork-workspace'),
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
  /** Default topK for automatic agent recall. */
  INDEXER_DEFAULT_TOP_K: z.coerce.number().int().min(1).max(50).default(8),
  /** Days before soft-deleted index docs / done jobs are pruned. */
  INDEXER_PRUNE_DAYS: z.coerce.number().int().min(1).max(3650).default(30),
=======
  CLEANUP_ENABLED: envBool(true),
  CLEANUP_INTERVAL_MS: z.coerce.number().default(3_600_000),
  CLEANUP_RUN_EVENT_RETENTION_DAYS: z.coerce.number().default(7),
  CLEANUP_ARCHIVED_SESSION_RETENTION_DAYS: z.coerce.number().default(30),
  CLEANUP_SANDBOX_RETENTION_MINUTES: z.coerce.number().default(60),
>>>>>>> origin/cursor/setup-dev-environment-9393
})

export type Env = z.infer<typeof envSchema>

export function loadConfig(): Env {
  const raw = envSchema.parse(process.env)
  return {
    ...raw,
    SKILLS_DIR: resolveFromRepoRoot(raw.SKILLS_DIR),
    WORKSPACE_ROOT: resolveFromRepoRoot(raw.WORKSPACE_ROOT),
  }
}

export const config = loadConfig()
