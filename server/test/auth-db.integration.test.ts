import { afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { getDb, getSql } from '../src/db/client'
import { authSchema } from '../src/db/auth-schema'
import { verifyAuthTables } from '../src/db/auth-db'
import { isIntegrationEnabled, prepareIntegrationDb, truncateAppTables } from './helpers/db'

const enabled = await isIntegrationEnabled()

describe.skipIf(!enabled)('auth database (better-auth + Postgres)', () => {
  beforeAll(async () => {
    await prepareIntegrationDb()
  })

  afterEach(async () => {
    await truncateAppTables()
  })

  test('migration 0015 auth tables exist', async () => {
    const status = await verifyAuthTables()
    expect(status.ok).toBe(true)
    expect(status.missing).toEqual([])
  })

  test('sign-up persists user, account, and session rows', async () => {
    const auth = betterAuth({
      secret: 'integration-test-secret-32chars!!',
      baseURL: 'http://127.0.0.1:3001',
      database: drizzleAdapter(getDb(), { provider: 'pg', schema: authSchema }),
      emailAndPassword: { enabled: true },
    })

    const email = `integ-${Date.now()}@test.local`
    const res = await auth.api.signUpEmail({
      body: { email, password: 'TestPass123!', name: 'Integration' },
    })
    expect(res?.user?.id).toBeTruthy()

    const sql = getSql()
    const [userRow] = await sql`SELECT email FROM "user" WHERE id = ${res!.user!.id}`
    expect((userRow as { email: string }).email).toBe(email)

    const [sessionRow] = await sql`
      SELECT count(*)::int AS n FROM session WHERE user_id = ${res!.user!.id}
    `
    expect(Number((sessionRow as { n: number }).n)).toBeGreaterThanOrEqual(1)

    const [accountRow] = await sql`
      SELECT count(*)::int AS n FROM account WHERE user_id = ${res!.user!.id}
    `
    expect(Number((accountRow as { n: number }).n)).toBeGreaterThanOrEqual(1)
  })
})
