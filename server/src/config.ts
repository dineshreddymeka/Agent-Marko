import { z } from 'zod'

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

const envSchema = z.object({
  DATABASE_URL: z.string().default('postgres://hermes:hermes@localhost:5433/hermes'),
  HERMES_DATA_DIR: z.string().default('C:/hermes-data'),
  HERMES_BACKUP_DIR: z.string().default('C:/hermes-data/backups'),
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
  HERMES_PYTHON_URL: z.string().optional(),
  SKILLS_DIR: z.string().default('./skills'),
  AUTO_APPROVE_ALL: envBool(false),
  CONTEXT_TOKEN_LIMIT: z.coerce.number().default(128_000),
  CONTEXT_INJECTION_BUDGET: z.coerce.number().default(8000),
  CLEANUP_ENABLED: envBool(true),
  CLEANUP_INTERVAL_MS: z.coerce.number().default(3_600_000),
  CLEANUP_RUN_EVENT_RETENTION_DAYS: z.coerce.number().default(7),
  CLEANUP_ARCHIVED_SESSION_RETENTION_DAYS: z.coerce.number().default(30),
  CLEANUP_SANDBOX_RETENTION_MINUTES: z.coerce.number().default(60),
})

export type Env = z.infer<typeof envSchema>

export function loadConfig(): Env {
  return envSchema.parse(process.env)
}

export const config = loadConfig()
