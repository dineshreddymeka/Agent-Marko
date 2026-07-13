import { getSql } from '../src/db/client'

const sql = getSql()
const tables = await sql`
  SELECT table_name FROM information_schema.tables
  WHERE table_schema = 'public'
    AND table_name IN ('user', 'session', 'account', 'verification')
  ORDER BY 1
`
console.log(
  'auth tables:',
  (tables as { table_name: string }[]).map((t) => t.table_name),
)
