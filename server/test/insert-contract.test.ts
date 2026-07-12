import { describe, expect, test } from 'bun:test'
import { withInsertContract, nowTimestamp } from '../src/db/insert-contract'

describe('insert contract helper', () => {
  test('withInsertContract sets createdAt and optional sessionId', () => {
    const now = new Date('2026-07-12T00:00:00.000Z')
    const row = withInsertContract(
      { key: 'theme', value: { mode: 'dark' } },
      { sessionId: null, withUpdated: true, now },
    )
    expect(row.createdAt).toEqual(now)
    expect(row.updatedAt).toEqual(now)
    expect(row.sessionId).toBeNull()
    expect(row.key).toBe('theme')
  })

  test('nowTimestamp returns a Date', () => {
    expect(nowTimestamp()).toBeInstanceOf(Date)
  })
})
