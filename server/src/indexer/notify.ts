/** Postgres LISTEN/NOTIFY channel for indexer job wake-ups. */
export const INDEX_JOBS_CHANNEL = 'jarvis_index_jobs'

type WakeHandler = () => void

const wakeHandlers = new Set<WakeHandler>()
let wakeTimer: ReturnType<typeof setTimeout> | null = null

/** Register an in-process wake callback (worker drain). Returns unsubscribe. */
export function onIndexJobWake(handler: WakeHandler): () => void {
  wakeHandlers.add(handler)
  return () => {
    wakeHandlers.delete(handler)
  }
}

/** Debounced in-process wake so bursty enqueues collapse into one drain. */
export function wakeIndexWorkers(delayMs = 25): void {
  if (wakeTimer) clearTimeout(wakeTimer)
  wakeTimer = setTimeout(() => {
    wakeTimer = null
    for (const handler of wakeHandlers) {
      try {
        handler()
      } catch {
        // handlers must never break enqueue path
      }
    }
  }, delayMs)
  wakeTimer.unref?.()
}
