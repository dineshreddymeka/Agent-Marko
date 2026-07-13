import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { getDb, getSql } from '../src/db/client'
import { authSchema } from '../src/db/auth-schema'

const auth = betterAuth({
  secret: 'test-secret-min-32-chars-long!!',
  baseURL: 'http://127.0.0.1:3001',
  database: drizzleAdapter(getDb(), { provider: 'pg', schema: authSchema }),
  emailAndPassword: { enabled: true },
})

const email = `dbwire-${Date.now()}@test.local`
const res = await auth.api.signUpEmail({
  body: { email, password: 'TestPass123!', name: 'DB Wire' },
})
if (!res?.user?.id) {
  console.error('signUp failed', res)
  process.exit(1)
}
console.log('signUp ok', res.user.id)

const sql = getSql()
const sessions = await sql`
  SELECT count(*)::int AS n FROM session WHERE user_id = ${res.user.id}
`
console.log('session rows', sessions[0])

await sql`DELETE FROM session WHERE user_id = ${res.user.id}`
await sql`DELETE FROM account WHERE user_id = ${res.user.id}`
await sql`DELETE FROM "user" WHERE id = ${res.user.id}`
console.log('cleanup ok')
