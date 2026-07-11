import { describe, expect, test } from 'bun:test'
import { stripLeadingComments } from '../src/db/migrate'

describe('migrate SQL parsing', () => {
  test('stripLeadingComments keeps CREATE EXTENSION after file header comment', () => {
    const chunk = `-- Hermes UI initial schema (Postgres 17 + pgvector)
CREATE EXTENSION IF NOT EXISTS vector`
    expect(stripLeadingComments(chunk)).toBe('CREATE EXTENSION IF NOT EXISTS vector')
  })

  test('stripLeadingComments removes inline comment-only lines only', () => {
    const chunk = `-- one
-- two
CREATE TABLE foo (id INT)`
    expect(stripLeadingComments(chunk)).toBe('CREATE TABLE foo (id INT)')
  })
})
