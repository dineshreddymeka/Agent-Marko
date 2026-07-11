import { describe, expect, test } from 'bun:test'
import type { Session } from './api-types'

describe('api-types', () => {
  test('session shape', () => {
    const s: Session = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      title: 'Test',
      groupName: null,
      profileId: null,
      pinned: false,
      archived: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    expect(s.title).toBe('Test')
  })
})
