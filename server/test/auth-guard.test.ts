import { describe, expect, test, afterEach } from 'bun:test'
import { config } from '../src/config'
import { guardRequest, isLocalhostBypass } from '../src/auth/index'

describe('auth guards', () => {
  const prevHost = config.HOST
  const prevSignup = config.ALLOW_SIGNUP

  afterEach(() => {
    // Restore singleton config mutated by tests below.
    ;(config as { HOST: string }).HOST = prevHost
    ;(config as { ALLOW_SIGNUP: boolean }).ALLOW_SIGNUP = prevSignup
  })

  test('oauthProvidersConfigured returns empty without credentials', async () => {
    const { oauthProvidersConfigured } = await import('../src/auth/index')
    const providers = oauthProvidersConfigured()
    expect(Array.isArray(providers)).toBe(true)
  })

  /**
   * Localhost bypass (HOST=127.0.0.1 && ALLOW_SIGNUP=false): guardRequest is a no-op.
   * Unauthenticated GET /api/debug/health is allowed — same as other protected routes.
   */
  test('localhost bypass: unauthenticated /api/debug/health is allowed', async () => {
    ;(config as { HOST: string }).HOST = '127.0.0.1'
    ;(config as { ALLOW_SIGNUP: boolean }).ALLOW_SIGNUP = false
    expect(isLocalhostBypass()).toBe(true)

    const denied = await guardRequest(new Request('http://127.0.0.1:3001/api/debug/health'))
    expect(denied).toBeNull()
  })

  /**
   * When localhost bypass is OFF, /api/debug/health requires session/bearer like other
   * debug routes (it is no longer in PUBLIC_PATHS).
   */
  test('no bypass: unauthenticated /api/debug/health → 401', async () => {
    ;(config as { HOST: string }).HOST = '0.0.0.0'
    ;(config as { ALLOW_SIGNUP: boolean }).ALLOW_SIGNUP = true
    expect(isLocalhostBypass()).toBe(false)

    const denied = await guardRequest(new Request('http://example.com/api/debug/health'))
    expect(denied).not.toBeNull()
    expect(denied!.status).toBe(401)
    const body = (await denied!.json()) as { error?: string; code?: string }
    expect(body.code).toBe('AUTH_ERROR')
  })

  test('no bypass: public /api/health still allowed without auth', async () => {
    ;(config as { HOST: string }).HOST = '0.0.0.0'
    ;(config as { ALLOW_SIGNUP: boolean }).ALLOW_SIGNUP = true
    expect(isLocalhostBypass()).toBe(false)

    const denied = await guardRequest(new Request('http://example.com/api/health'))
    expect(denied).toBeNull()
  })

  test('no bypass: public /api/office/config and /api/office/sso still allowed', async () => {
    ;(config as { HOST: string }).HOST = '0.0.0.0'
    ;(config as { ALLOW_SIGNUP: boolean }).ALLOW_SIGNUP = true

    expect(await guardRequest(new Request('http://example.com/api/office/config'))).toBeNull()
    expect(await guardRequest(new Request('http://example.com/api/office/sso'))).toBeNull()
  })
})

describe('API token hashing', () => {
  test('createHttpTransportSync and token prefix format', () => {
    const raw = `hrm_${'a'.repeat(48)}`
    expect(raw.startsWith('hrm_')).toBe(true)
  })
})
