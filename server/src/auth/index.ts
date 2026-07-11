import { betterAuth } from 'better-auth'
import { config } from '../config'

export const auth = betterAuth({
  baseURL: config.BETTER_AUTH_URL,
  secret: config.BETTER_AUTH_SECRET,
  emailAndPassword: {
    enabled: true,
    disableSignUp: !config.ALLOW_SIGNUP,
  },
  trustedOrigins: ['http://127.0.0.1:5173', 'http://localhost:5173', config.BETTER_AUTH_URL],
})

export type AuthSession = {
  user: { id: string; email: string; name?: string }
  session: { id: string; userId: string; expiresAt: Date }
}

const PUBLIC_PATHS = new Set(['/api/health', '/api/debug/health'])

export async function requireAuth(req: Request): Promise<AuthSession | null> {
  const url = new URL(req.url)
  if (PUBLIC_PATHS.has(url.pathname)) return null

  // Localhost dev: auth optional when bound to 127.0.0.1
  if (config.HOST === '127.0.0.1' && !config.ALLOW_SIGNUP) {
    return null
  }

  const session = await auth.api.getSession({ headers: req.headers })
  if (!session) return null
  return session as AuthSession
}

export async function guardRequest(req: Request): Promise<Response | null> {
  const url = new URL(req.url)
  if (url.pathname.startsWith('/api/auth')) return null

  if (config.HOST === '127.0.0.1' && !config.ALLOW_SIGNUP) {
    return null
  }
  const session = await requireAuth(req)
  if (!session) {
    return Response.json({ error: 'Unauthorized', code: 'AUTH_ERROR' }, { status: 401 })
  }
  return null
}