import { z } from 'zod'

const envSchema = z.object({
  DATABASE_URL: z.string().default('postgres://hermes:hermes@localhost:5433/hermes'),
  HERMES_DATA_DIR: z.string().default('C:/hermes-data'),
  HERMES_BACKUP_DIR: z.string().default('C:/hermes-data/backups'),
  LLM_BASE_URL: z.string().default('https://api.openai.com/v1'),
  LLM_API_KEY: z.string().default(''),
  EMBEDDINGS_MODEL: z.string().default('text-embedding-3-small'),
  EMBEDDING_DIMENSION: z.coerce.number().default(1536),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  DEBUG_LLM: z.coerce.boolean().default(false),
  ALLOW_SIGNUP: z.coerce.boolean().default(false),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().default(3001),
  WORKSPACE_ROOT: z.string().default('./workspace'),
  BETTER_AUTH_SECRET: z.string().default('dev-secret-change-in-production'),
  BETTER_AUTH_URL: z.string().default('http://127.0.0.1:3001'),
  HERMES_PYTHON_URL: z.string().optional(),
  SKILLS_DIR: z.string().default('./skills'),
  AUTO_APPROVE_ALL: z.coerce.boolean().default(false),
})

export type Env = z.infer<typeof envSchema>

export function loadConfig(): Env {
  return envSchema.parse(process.env)
}

export const config = loadConfig()
