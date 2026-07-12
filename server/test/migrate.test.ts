import { describe, expect, test } from 'bun:test'
import {
  stripLeadingComments,
  discoverMigrationFiles,
  splitPostgresStatements,
  applyMigrationWithLedger,
} from '../src/db/migrate'

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

describe('migration file discovery', () => {
  test('discovers .sql files sorted lexicographically', () => {
    const files = discoverMigrationFiles()
    expect(files.length).toBeGreaterThanOrEqual(2)
    expect(files[0]).toBe('0001_init.sql')
    expect(files[1]).toBe('0002_perf_indexes.sql')
    expect(files).toContain('0003_api_tokens.sql')
    expect(files).toContain('0006_integrity_fixes.sql')
    expect(files).toContain('0007_skills_sync.sql')
    expect(files).toContain('0008_jarvis_indexer.sql')
    expect(files).toContain('0009_insert_contract.sql')
    expect(files).toContain('0009_jarvis_indexer_perf.sql')
    expect(files).toContain('0011_jarvis_indexer_integrity.sql')
    expect(files).toContain('0012_index_jobs_columns.sql')
    for (let i = 1; i < files.length; i++) {
      expect(files[i]! > files[i - 1]!).toBe(true)
    }
  })

  test('returns empty array for nonexistent directory', () => {
    const files = discoverMigrationFiles('/nonexistent/path')
    expect(files).toEqual([])
  })

  test('all discovered files end with .sql', () => {
    const files = discoverMigrationFiles()
    for (const f of files) {
      expect(f.endsWith('.sql')).toBe(true)
    }
  })
})

describe('splitPostgresStatements', () => {
  test('splits normal multi-statement migration', () => {
    const sql = `
CREATE TABLE a (id INT);
CREATE TABLE b (id INT);
INSERT INTO a VALUES (1);
`
    expect(splitPostgresStatements(sql)).toEqual([
      'CREATE TABLE a (id INT)',
      'CREATE TABLE b (id INT)',
      'INSERT INTO a VALUES (1)',
    ])
  })

  test('does not split on semicolon inside a string literal', () => {
    const sql = `
INSERT INTO notes (body) VALUES ('hello; world');
CREATE TABLE t (id INT);
`
    expect(splitPostgresStatements(sql)).toEqual([
      "INSERT INTO notes (body) VALUES ('hello; world')",
      'CREATE TABLE t (id INT)',
    ])
  })

  test('handles escaped quotes inside string literals', () => {
    const sql = `INSERT INTO notes (body) VALUES ('it''s; fine'); SELECT 1;`
    expect(splitPostgresStatements(sql)).toEqual([
      "INSERT INTO notes (body) VALUES ('it''s; fine')",
      'SELECT 1',
    ])
  })

  test('does not split on semicolon inside dollar-quoted block', () => {
    const sql = `
DO $$
BEGIN
  PERFORM 1;
  PERFORM 2;
END
$$;
CREATE TABLE after_do (id INT);
`
    const stmts = splitPostgresStatements(sql)
    expect(stmts).toHaveLength(2)
    expect(stmts[0]).toContain('DO $$')
    expect(stmts[0]).toContain('PERFORM 1;')
    expect(stmts[0]).toContain('PERFORM 2;')
    expect(stmts[0]).toContain('$$')
    expect(stmts[1]).toBe('CREATE TABLE after_do (id INT)')
  })

  test('handles tagged dollar quotes', () => {
    const sql = `CREATE FUNCTION f() RETURNS void AS $body$
BEGIN
  RAISE NOTICE 'x;y';
END;
$body$ LANGUAGE plpgsql;
SELECT 1;`
    const stmts = splitPostgresStatements(sql)
    expect(stmts).toHaveLength(2)
    expect(stmts[0]).toContain('$body$')
    expect(stmts[0]).toContain("RAISE NOTICE 'x;y';")
    expect(stmts[1]).toBe('SELECT 1')
  })

  test('ignores semicolon inside line comment', () => {
    const sql = `
-- note: old statement; do not run
CREATE TABLE ok (id INT);
`
    expect(splitPostgresStatements(sql)).toEqual(['CREATE TABLE ok (id INT)'])
  })
})

describe('applyMigrationWithLedger', () => {
  test('inserts ledger only after all statements succeed', async () => {
    const executed: string[] = []
    const ledger: string[] = []

    await applyMigrationWithLedger(
      {
        unsafe: async (query) => {
          executed.push(query)
        },
        insertLedger: async (name) => {
          ledger.push(name)
        },
      },
      '0006_example.sql',
      ['CREATE TABLE a (id INT)', 'CREATE TABLE b (id INT)'],
    )

    expect(executed).toEqual([
      'CREATE TABLE a (id INT);',
      'CREATE TABLE b (id INT);',
    ])
    expect(ledger).toEqual(['0006_example.sql'])
  })

  test('failure does not leave a ledger row', async () => {
    const ledger: string[] = []
    let calls = 0

    await expect(
      applyMigrationWithLedger(
        {
          unsafe: async () => {
            calls++
            if (calls === 2) throw new Error('boom')
          },
          insertLedger: async (name) => {
            ledger.push(name)
          },
        },
        'bad.sql',
        ['ok', 'fails', 'never'],
      ),
    ).rejects.toThrow('boom')

    expect(calls).toBe(2)
    expect(ledger).toEqual([])
  })
})
