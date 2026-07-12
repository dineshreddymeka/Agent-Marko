import { describe, expect, test } from 'bun:test'
import {
  OPEN_JARVIS_CSP,
  securityHeaders,
  shouldAttachCsp,
} from '../src/security-headers'

describe('CSP headers (SoT B32)', () => {
  test('disabled by default in non-production', () => {
    expect(shouldAttachCsp({ NODE_ENV: 'development' })).toBe(false)
    expect(securityHeaders({ NODE_ENV: 'development' })).toEqual({})
  })

  test('enabled when HERMES_CSP=1 or production', () => {
    expect(shouldAttachCsp({ HERMES_CSP: '1' })).toBe(true)
    expect(shouldAttachCsp({ NODE_ENV: 'production' })).toBe(true)
    const headers = securityHeaders({ HERMES_CSP: '1' })
    expect(headers['Content-Security-Policy']).toBe(OPEN_JARVIS_CSP)
    expect(headers['Content-Security-Policy']).toContain("default-src 'self'")
    expect(headers['Content-Security-Policy']).toContain("frame-ancestors 'none'")
  })
})
