/** Prod CSP for Open Jarvis (SoT Phase 7 / B32). */
export const OPEN_JARVIS_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' ws: wss: http: https:",
  "media-src 'self' blob: https:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ')

export function shouldAttachCsp(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.NODE_ENV === 'production' || env.HERMES_CSP === '1'
}

export function securityHeaders(
  env: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  if (!shouldAttachCsp(env)) return {}
  return { 'Content-Security-Policy': OPEN_JARVIS_CSP }
}
