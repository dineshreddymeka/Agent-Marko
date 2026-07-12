import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, writeFileSync, rmSync, existsSync, readdirSync, utimesSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  parseBackupKeep,
  pruneBackupDumps,
  listBackupDumps,
} from '../../scripts/lib/backup-retention'

describe('backup retention', () => {
  let dir: string

  beforeEach(() => {
    dir = join(tmpdir(), `hermes-backup-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(dir, { recursive: true })
  })

  afterEach(() => {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
  })

  test('parseBackupKeep defaults and clamps', () => {
    expect(parseBackupKeep(undefined)).toBe(10)
    expect(parseBackupKeep('')).toBe(10)
    expect(parseBackupKeep('5')).toBe(5)
    expect(parseBackupKeep('0')).toBe(10)
    expect(parseBackupKeep('nope')).toBe(10)
  })

  test('pruneBackupDumps keeps newest N hermes-*.sql files', () => {
    writeFileSync(join(dir, 'notes.txt'), 'keep me')
    const dumps = [
      'hermes-2026-01-01T00-00-00.sql',
      'hermes-2026-02-01T00-00-00.sql',
      'hermes-2026-03-01T00-00-00.sql',
    ]
    const base = Date.now() - 60_000
    for (let i = 0; i < dumps.length; i++) {
      const path = join(dir, dumps[i]!)
      writeFileSync(path, `-- ${dumps[i]}\n`)
      const t = new Date(base + i * 1000)
      utimesSync(path, t, t)
    }

    const deleted = pruneBackupDumps(dir, 2)
    expect(deleted).toHaveLength(1)
    expect(listBackupDumps(dir).map((d) => d.name)).toEqual([
      'hermes-2026-03-01T00-00-00.sql',
      'hermes-2026-02-01T00-00-00.sql',
    ])
    expect(readdirSync(dir)).toContain('notes.txt')
  })
})
