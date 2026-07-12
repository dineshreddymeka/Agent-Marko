/** Prefer reduced motion for stream pacing and UI transitions. */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false
  }
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

/** React hook wrapper around prefersReducedMotion (re-reads on mount). */
export function useReducedMotion(): boolean {
  return prefersReducedMotion()
}
