export type GraphDateTime = {
  dateTime?: string
  timeZone?: string
}

export type GraphEvent = {
  id?: string
  subject?: string
  start?: GraphDateTime
  end?: GraphDateTime
  isCancelled?: boolean
  isOnlineMeeting?: boolean
  onlineMeeting?: { joinUrl?: string } | null
  location?: { displayName?: string } | null
  attendees?: Array<{
    type?: string
    status?: { response?: string }
    emailAddress?: { name?: string; address?: string }
  }>
}

export type BriefingMeeting = {
  id: string
  title: string
  start: string
  end: string
  timeLabel: string
  status: 'Done' | 'In progress' | 'Upcoming' | 'Cancelled'
  meta: string
  isOnlineMeeting: boolean
  joinUrl: string | null
  attendeeCount: number
  durationMinutes: number
}

export type OfficeBriefing = {
  live: true
  syncedAt: string
  connected: true
  account: unknown
  stats: {
    meetingTime: string
    meetingTimeMinutes: number
    meetingCount: number
    onlineMeetingCount: number
    focusBlocks: number
    upcomingCount: number
    doneCount: number
  }
  agenda: BriefingMeeting[]
  insights: string[]
  actions: string[]
  note: string
}

/** Parse Graph dateTime; Prefer: outlook.timezone="UTC" returns UTC wall times. */
export function parseGraphDate(value?: GraphDateTime): Date | null {
  if (!value?.dateTime) return null
  const raw = value.dateTime.trim()
  const hasZone = /Z$|[+-]\d{2}:\d{2}$/.test(raw)
  const parsed = new Date(hasZone ? raw : `${raw}Z`)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

export function formatDuration(totalMinutes: number): string {
  const mins = Math.max(0, Math.round(totalMinutes))
  const h = Math.floor(mins / 60)
  const m = mins % 60
  if (h === 0) return `${m}m`
  if (m === 0) return `${h}h`
  return `${h}h ${m}m`
}

export function formatTimeLabel(date: Date, timeZone?: string): string {
  try {
    return date.toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
      ...(timeZone ? { timeZone } : {}),
    })
  } catch {
    return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  }
}

export function meetingStatus(
  start: Date,
  end: Date,
  cancelled: boolean,
  now: Date,
): BriefingMeeting['status'] {
  if (cancelled) return 'Cancelled'
  if (end.getTime() <= now.getTime()) return 'Done'
  if (start.getTime() <= now.getTime() && end.getTime() > now.getTime()) return 'In progress'
  return 'Upcoming'
}

export function countFocusBlocks(meetings: BriefingMeeting[], now: Date): number {
  const active = meetings
    .filter((m) => m.status !== 'Cancelled')
    .map((m) => ({ start: Date.parse(m.start), end: Date.parse(m.end) }))
    .filter((m) => Number.isFinite(m.start) && Number.isFinite(m.end))
    .sort((a, b) => a.start - b.start)

  const workStart = new Date(now)
  workStart.setHours(9, 0, 0, 0)
  const workEnd = new Date(now)
  workEnd.setHours(17, 0, 0, 0)

  let cursor = Math.max(workStart.getTime(), now.getTime())
  const endMs = workEnd.getTime()
  if (cursor >= endMs) return 0

  let blocks = 0
  for (const meeting of active) {
    if (meeting.end <= cursor) continue
    if (meeting.start > cursor) {
      const gapMin = (Math.min(meeting.start, endMs) - cursor) / 60_000
      if (gapMin >= 30) blocks += 1
    }
    cursor = Math.max(cursor, meeting.end)
    if (cursor >= endMs) break
  }
  if (cursor < endMs) {
    const gapMin = (endMs - cursor) / 60_000
    if (gapMin >= 30) blocks += 1
  }
  return blocks
}

export function buildBriefingFromEvents(
  events: GraphEvent[],
  account: unknown,
  now = new Date(),
  timeZone?: string,
): OfficeBriefing {
  const meetings: BriefingMeeting[] = []
  for (const event of events) {
    const start = parseGraphDate(event.start)
    const end = parseGraphDate(event.end)
    if (!start || !end || !event.id) continue
    if (end.getTime() < start.getTime()) continue

    const durationMinutes = Math.max(1, Math.round((end.getTime() - start.getTime()) / 60_000))
    const attendeeCount = Array.isArray(event.attendees) ? event.attendees.length : 0
    const cancelled = Boolean(event.isCancelled)
    const status = meetingStatus(start, end, cancelled, now)
    const location = event.location?.displayName?.trim()
    const online = Boolean(event.isOnlineMeeting)
    const metaParts = [
      formatDuration(durationMinutes),
      attendeeCount ? `${attendeeCount} invitee${attendeeCount === 1 ? '' : 's'}` : null,
      online ? 'Teams' : location || null,
    ].filter(Boolean)

    meetings.push({
      id: event.id,
      title: event.subject?.trim() || '(No title)',
      start: start.toISOString(),
      end: end.toISOString(),
      timeLabel: formatTimeLabel(start, timeZone),
      status,
      meta: metaParts.join(' · '),
      isOnlineMeeting: online,
      joinUrl: event.onlineMeeting?.joinUrl ?? null,
      attendeeCount,
      durationMinutes,
    })
  }

  meetings.sort((a, b) => Date.parse(a.start) - Date.parse(b.start))

  const countable = meetings.filter((m) => m.status !== 'Cancelled')
  const scheduledMinutes = countable.reduce((sum, m) => sum + m.durationMinutes, 0)
  const onlineCount = countable.filter((m) => m.isOnlineMeeting).length
  const upcoming = countable.filter((m) => m.status === 'Upcoming' || m.status === 'In progress')
  const done = countable.filter((m) => m.status === 'Done')
  const focusBlocks = countFocusBlocks(meetings, now)

  const insights: string[] = []
  if (countable.length === 0) {
    insights.push('No calendar meetings found for today in Microsoft Graph.')
  } else {
    insights.push(
      `Today has ${countable.length} meeting${countable.length === 1 ? '' : 's'} totaling ${formatDuration(scheduledMinutes)} on your calendar.`,
    )
    if (onlineCount > 0) {
      insights.push(`${onlineCount} of those are Teams online meetings.`)
    }
    const next = upcoming[0]
    if (next) {
      insights.push(`Next up: ${next.title} at ${next.timeLabel}.`)
    } else if (done.length > 0) {
      insights.push('No remaining meetings on today’s calendar.')
    }
  }

  const actions: string[] = []
  for (const meeting of upcoming.slice(0, 3)) {
    actions.push(`Prepare for ${meeting.title} (${meeting.timeLabel})`)
  }
  for (const meeting of done.filter((m) => m.isOnlineMeeting).slice(0, 2)) {
    actions.push(`Check transcript/attendance for ${meeting.title}`)
  }

  return {
    live: true,
    syncedAt: now.toISOString(),
    connected: true,
    account,
    stats: {
      meetingTime: formatDuration(scheduledMinutes),
      meetingTimeMinutes: scheduledMinutes,
      meetingCount: countable.length,
      onlineMeetingCount: onlineCount,
      focusBlocks,
      upcomingCount: upcoming.length,
      doneCount: done.length,
    },
    agenda: meetings,
    insights,
    actions,
    note:
      'Meeting hours are from calendar duration. Teams attendance reports and transcripts appear after meetings end when Graph permissions allow.',
  }
}

/** Resolve today window. Prefer client-provided ISO bounds; else server local day. */
export function resolveDayBounds(input: {
  start?: string | null
  end?: string | null
  now?: Date
}): { start: Date; end: Date } {
  const now = input.now ?? new Date()
  if (input.start && input.end) {
    const start = new Date(input.start)
    const end = new Date(input.end)
    if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime()) && end > start) {
      // Cap to 48h window to avoid abuse
      if (end.getTime() - start.getTime() <= 48 * 60 * 60 * 1000) {
        return { start, end }
      }
    }
  }
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  const end = new Date(now)
  end.setHours(23, 59, 59, 999)
  return { start, end }
}

export function tokenExpiresAtMs(token: {
  expiresAt?: string
  storedAt?: string
  expires_in?: number
}): number | null {
  if (token.expiresAt) {
    const parsed = Date.parse(token.expiresAt)
    if (!Number.isNaN(parsed)) return parsed
  }
  if (token.storedAt && typeof token.expires_in === 'number') {
    const stored = Date.parse(token.storedAt)
    if (!Number.isNaN(stored)) return stored + token.expires_in * 1000
  }
  return null
}
