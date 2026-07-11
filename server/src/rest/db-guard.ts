import { pingDatabase } from '../db/client'
import { DbError } from '../errors'

let lastDbCheck = 0
let lastDbOk = false
const DB_CHECK_TTL_MS = 5_000

export async function isDatabaseAvailable(): Promise<boolean> {
  const now = Date.now()
  if (now - lastDbCheck < DB_CHECK_TTL_MS) return lastDbOk
  lastDbOk = await pingDatabase()
  lastDbCheck = now
  return lastDbOk
}

export async function requireDatabaseOrResponse(): Promise<Response | null> {
  if (await isDatabaseAvailable()) return null
  return Response.json(
    {
      error: 'Database unavailable',
      code: 'DB_UNAVAILABLE',
      hint: 'Start Postgres with `bun run db:up` then `bun run migrate`.',
    },
    { status: 503 },
  )
}

export async function withDatabase<T>(
  fn: () => Promise<T>,
  fallback: T,
): Promise<T> {
  if (!(await isDatabaseAvailable())) return fallback
  try {
    return await fn()
  } catch (err) {
    if (err instanceof DbError) return fallback
    throw err
  }
}
