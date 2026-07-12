import { describe, expect, test } from 'bun:test'
import {
  buildBriefingFromEvents,
  countFocusBlocks,
  formatDuration,
  meetingStatus,
  parseGraphDate,
  resolveDayBounds,
  tokenExpiresAtMs,
  type BriefingMeeting,
} from '../src/office/briefing'
import { decryptSecret, encryptSecret, signOfficeState, verifyOfficeState } from '../src/office/crypto'
import { createHash } from 'node:crypto'

const secret = createHash('sha256').update('test-office-secret').digest()

describe('office crypto', () => {
  test('encrypt/decrypt roundtrip', () => {
    const payload = { access_token: 'abc', refresh_token: 'xyz' }
    const sealed = encryptSecret(payload, secret)
    expect(decryptSecret<typeof payload>(sealed, secret)).toEqual(payload)
  })

  test('rejects tampered ciphertext', () => {
    const sealed = encryptSecret({ a: 1 }, secret)
    sealed.data = sealed.data.slice(0, -2) + 'aa'
    expect(decryptSecret(sealed, secret)).toBeNull()
  })

  test('state sign/verify and expiry', () => {
    const state = signOfficeState(
      { nonce: 'n1', exp: Date.now() + 60_000, returnTo: 'http://127.0.0.1:5173/panel/office' },
      secret,
    )
    const ok = verifyOfficeState(state, secret)
    expect(ok?.nonce).toBe('n1')

    const expired = signOfficeState(
      { nonce: 'n2', exp: Date.now() - 1, returnTo: 'http://127.0.0.1:5173/panel/office' },
      secret,
    )
    expect(verifyOfficeState(expired, secret)).toBeNull()
    expect(verifyOfficeState(state + 'x', secret)).toBeNull()
  })
})

describe('office briefing helpers', () => {
  test('parseGraphDate handles UTC Prefer values', () => {
    const d = parseGraphDate({ dateTime: '2026-07-12T15:30:00.0000000', timeZone: 'UTC' })
    expect(d?.toISOString()).toBe('2026-07-12T15:30:00.000Z')
  })

  test('formatDuration', () => {
    expect(formatDuration(0)).toBe('0m')
    expect(formatDuration(45)).toBe('45m')
    expect(formatDuration(60)).toBe('1h')
    expect(formatDuration(90)).toBe('1h 30m')
  })

  test('meetingStatus', () => {
    const now = new Date('2026-07-12T16:00:00Z')
    expect(
      meetingStatus(new Date('2026-07-12T14:00:00Z'), new Date('2026-07-12T15:00:00Z'), false, now),
    ).toBe('Done')
    expect(
      meetingStatus(new Date('2026-07-12T15:30:00Z'), new Date('2026-07-12T16:30:00Z'), false, now),
    ).toBe('In progress')
    expect(
      meetingStatus(new Date('2026-07-12T17:00:00Z'), new Date('2026-07-12T18:00:00Z'), false, now),
    ).toBe('Upcoming')
    expect(
      meetingStatus(new Date('2026-07-12T17:00:00Z'), new Date('2026-07-12T18:00:00Z'), true, now),
    ).toBe('Cancelled')
  })

  test('buildBriefingFromEvents is live-only and skips bad rows', () => {
    const now = new Date('2026-07-12T16:00:00Z')
    const briefing = buildBriefingFromEvents(
      [
        {
          id: '1',
          subject: 'Standup',
          start: { dateTime: '2026-07-12T14:00:00.0000000' },
          end: { dateTime: '2026-07-12T14:30:00.0000000' },
          isOnlineMeeting: true,
          attendees: [{}, {}],
        },
        {
          id: '2',
          subject: 'Planning',
          start: { dateTime: '2026-07-12T17:00:00.0000000' },
          end: { dateTime: '2026-07-12T18:00:00.0000000' },
        },
        {
          id: 'bad',
          subject: 'Broken',
          start: { dateTime: '2026-07-12T19:00:00.0000000' },
          end: { dateTime: '2026-07-12T18:00:00.0000000' },
        },
      ],
      { email: 'a@b.com' },
      now,
    )

    expect(briefing.live).toBe(true)
    expect(briefing.stats.meetingCount).toBe(2)
    expect(briefing.stats.onlineMeetingCount).toBe(1)
    expect(briefing.stats.doneCount).toBe(1)
    expect(briefing.stats.upcomingCount).toBe(1)
    expect(briefing.agenda).toHaveLength(2)
    expect(briefing.insights.length).toBeGreaterThan(0)
    expect(briefing.actions.some((a) => a.includes('Planning'))).toBe(true)
  })

  test('countFocusBlocks finds afternoon gaps', () => {
    const now = new Date('2026-07-12T10:00:00')
    const meetings: BriefingMeeting[] = [
      {
        id: '1',
        title: 'A',
        start: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 10, 0).toISOString(),
        end: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 11, 0).toISOString(),
        timeLabel: '10:00 AM',
        status: 'In progress',
        meta: '',
        isOnlineMeeting: false,
        joinUrl: null,
        attendeeCount: 0,
        durationMinutes: 60,
      },
    ]
    expect(countFocusBlocks(meetings, now)).toBeGreaterThanOrEqual(1)
  })

  test('resolveDayBounds prefers client window and rejects huge ranges', () => {
    const start = '2026-07-12T04:00:00.000Z'
    const end = '2026-07-12T28:00:00.000Z'
    // invalid end date — fall back
    const bad = resolveDayBounds({ start, end: 'nope', now: new Date('2026-07-12T12:00:00Z') })
    expect(bad.start.getHours()).toBe(0)

    const ok = resolveDayBounds({
      start: '2026-07-12T04:00:00.000Z',
      end: '2026-07-13T03:59:59.999Z',
    })
    expect(ok.start.toISOString()).toBe('2026-07-12T04:00:00.000Z')

    const huge = resolveDayBounds({
      start: '2026-07-01T00:00:00.000Z',
      end: '2026-07-10T00:00:00.000Z',
      now: new Date('2026-07-12T12:00:00Z'),
    })
    expect(huge.start.getHours()).toBe(0)
  })

  test('tokenExpiresAtMs', () => {
    expect(tokenExpiresAtMs({ expiresAt: '2026-07-12T12:00:00.000Z' })).toBe(
      Date.parse('2026-07-12T12:00:00.000Z'),
    )
    expect(
      tokenExpiresAtMs({ storedAt: '2026-07-12T12:00:00.000Z', expires_in: 3600 }),
    ).toBe(Date.parse('2026-07-12T13:00:00.000Z'))
    expect(tokenExpiresAtMs({})).toBeNull()
  })
})
