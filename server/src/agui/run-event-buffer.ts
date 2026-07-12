/** In-memory run event buffer when Postgres is unavailable (dev without Docker). */
import type { BaseEvent } from '@ag-ui/core'

export type BufferedRunEvent = {
  runId: string
  sessionId: string | null
  seq: number
  eventType: string
  payload: BaseEvent
  createdAt: string
}

const buffer = new Map<string, BufferedRunEvent[]>()
const MAX_RUNS = 50

export function bufferRunEvent(event: Omit<BufferedRunEvent, 'createdAt'>): void {
  const list = buffer.get(event.runId) ?? []
  list.push({ ...event, createdAt: new Date().toISOString() })
  buffer.set(event.runId, list)

  if (buffer.size > MAX_RUNS) {
    const oldest = buffer.keys().next().value
    if (oldest) buffer.delete(oldest)
  }
}

export function listBufferedRuns(limit = 20): Array<{ runId: string; sessionId: string | null; eventCount: number; lastEventAt: string }> {
  return [...buffer.entries()]
    .map(([runId, events]) => ({
      runId,
      sessionId: events[0]?.sessionId ?? null,
      eventCount: events.length,
      lastEventAt: events.at(-1)?.createdAt ?? '',
    }))
    .sort((a, b) => b.lastEventAt.localeCompare(a.lastEventAt))
    .slice(0, limit)
}

export function getBufferedRunEvents(runId: string): BufferedRunEvent[] {
  return buffer.get(runId) ?? []
}

export function bufferedRunCount(): number {
  return buffer.size
}

/** Drop buffered runs whose most recent event is older than maxAgeMs. Returns the number removed. */
export function pruneBufferedRuns(maxAgeMs: number): number {
  const cutoff = Date.now() - maxAgeMs
  let removed = 0
  for (const [runId, events] of buffer) {
    const last = events.at(-1)?.createdAt
    if (last && new Date(last).getTime() < cutoff) {
      buffer.delete(runId)
      removed++
    }
  }
  return removed
}
