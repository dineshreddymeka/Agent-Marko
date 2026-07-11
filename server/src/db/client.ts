import { SQL } from 'bun'
import { drizzle } from 'drizzle-orm/bun-sql'
import { config } from '../config'
import { logger } from '../log'
import { DbError } from '../errors'
import { schema } from './schema'

let sqlClient: SQL | null = null
let dbInstance: ReturnType<typeof drizzle<typeof schema>> | null = null

export function getSql(): SQL {
  if (!sqlClient) {
    sqlClient = new SQL(config.DATABASE_URL, { max: 10 })
  }
  return sqlClient
}

export function getDb() {
  if (!dbInstance) {
    dbInstance = drizzle({ client: getSql(), schema })
  }
  return dbInstance
}

export async function pingDatabase(): Promise<boolean> {
  try {
    const sql = getSql()
    await sql`SELECT 1 AS ok`
    return true
  } catch (err) {
    logger.error('Database ping failed', { error: String(err) })
    return false
  }
}

export async function requireDatabase(): Promise<void> {
  const ok = await pingDatabase()
  if (!ok) {
    throw new DbError(
      'Postgres is unreachable. Start with `bun run db:up` and check DATABASE_URL.',
    )
  }
}

export { schema }
