import { config } from '../config'

/** Vite / local-dev origins commonly used with the API. */
const DEV_ORIGINS = [
  'http://127.0.0.1:5173',
  'http://localhost:5173',
  'http://127.0.0.1:4173',
  'http://localhost:4173',
  'http://127.0.0.1:3000',
  'http://localhost:3000',
]

function normalizeOrigin(origin: string): string {
  return origin.replace(/\/$/, '')
}

/** Allowlisted CORS origins (never reflect arbitrary Origin with credentials). */
export function allowedCorsOrigins(): string[] {
  const set = new Set<string>()
  for (const o of DEV_ORIGINS) set.add(normalizeOrigin(o))
  try {
    set.add(normalizeOrigin(new URL(config.BETTER_AUTH_URL).origin))
  } catch {
    set.add(normalizeOrigin(config.BETTER_AUTH_URL))
  }
  if (config.HERMES_PUBLIC_URL) {
    try {
      set.add(normalizeOrigin(new URL(config.HERMES_PUBLIC_URL).origin))
    } catch {
      set.add(normalizeOrigin(config.HERMES_PUBLIC_URL))
    }
  }
  const extra = (config.CORS_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  for (const o of extra) set.add(normalizeOrigin(o))
  return [...set]
}

/**
 * Resolve Access-Control-Allow-Origin for a request.
 * Returns null when Origin is present but not allowlisted (omit ACAO).
 * Returns '*' only when there is no Origin header (non-browser / same-origin tooling).
 */
export function resolveCorsOrigin(req: Request): string | null {
  const origin = req.headers.get('Origin')
  if (!origin) return '*'
  const normalized = normalizeOrigin(origin)
  const allowed = allowedCorsOrigins()
  if (allowed.includes(normalized)) return normalized
  return null
}
