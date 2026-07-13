import { betterAuth } from 'better-auth'

import { bearer, twoFactor } from 'better-auth/plugins'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'

import { config } from '../config'
import { getDb } from '../db/client'

import { apiTokensRepo } from '../db/repositories/api_tokens'

import { isDebugChannel, logger } from '../log'

import { buildLdapCredentialsPlugin, ldapAuthConfigured } from './ldap'
import { allowedCorsOrigins } from '../security/cors'
import { authSchema } from '../db/auth-schema'



const log = logger.child({ component: 'auth' })



const ldapPlugin = buildLdapCredentialsPlugin()



function buildSocialProviders(): Record<string, { clientId: string; clientSecret: string }> | undefined {

  const providers: Record<string, { clientId: string; clientSecret: string }> = {}

  if (config.GITHUB_CLIENT_ID && config.GITHUB_CLIENT_SECRET) {

    providers.github = {

      clientId: config.GITHUB_CLIENT_ID,

      clientSecret: config.GITHUB_CLIENT_SECRET,

    }

  }

  if (config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET) {

    providers.google = {

      clientId: config.GOOGLE_CLIENT_ID,

      clientSecret: config.GOOGLE_CLIENT_SECRET,

    }

  }

  return Object.keys(providers).length > 0 ? providers : undefined

}



const socialProviders = buildSocialProviders()



const plugins = [

  bearer(),

  ...(config.ENABLE_TOTP ? [twoFactor()] : []),

  ...(ldapPlugin ? [ldapPlugin] : []),

]



export const auth = betterAuth({

  database: drizzleAdapter(getDb(), { provider: 'pg', schema: authSchema }),

  baseURL: config.BETTER_AUTH_URL,

  secret: config.BETTER_AUTH_SECRET,

  appName: 'Open Jarvis',

  emailAndPassword: {

    enabled: !ldapAuthConfigured(),

    disableSignUp: !config.ALLOW_SIGNUP,

  },

  ...(socialProviders ? { socialProviders } : {}),

  trustedOrigins: allowedCorsOrigins(),

  plugins,

})



if (ldapAuthConfigured()) {

  log.info('LDAP sign-in enabled', {

    url: config.LDAP_URL,

    baseDn: config.LDAP_BASE_DN,

    userAttribute: config.LDAP_USER_ATTRIBUTE,

  })

}



export type AuthSession = {

  user: { id: string; email: string; name?: string }

  session: { id: string; userId: string; expiresAt: Date }

  via?: 'session' | 'api_token' | 'localhost_bypass'

}



const PUBLIC_PATHS = new Set([

  '/api/health',

  '/api/office/callback',

  /** Public: Microsoft SSO start — login page navigates here before a session exists. */

  '/api/office/sso',

  /** Public: Microsoft Graph OAuth configured? (no secrets) — used by login page. */

  '/api/office/config',

  '/api/openapi.json',

  '/api/docs',

])



function isPublicPath(pathname: string): boolean {

  if (PUBLIC_PATHS.has(pathname)) return true

  if (pathname === '/api/docs/' || pathname.startsWith('/api/docs/assets/')) return true

  return false

}



function extractBearer(req: Request): string | null {

  const header = req.headers.get('Authorization')

  if (!header) return null

  const match = header.match(/^Bearer\s+(.+)$/i)

  return match?.[1]?.trim() ?? null

}



/** Localhost + ALLOW_SIGNUP=false keeps auth optional for local-first DX (unless LDAP is on). */

export function isLocalhostBypass(): boolean {

  if (ldapAuthConfigured()) return false

  return config.HOST === '127.0.0.1' && !config.ALLOW_SIGNUP

}



export function authRequired(): boolean {

  return !isLocalhostBypass()

}



export async function requireAuth(req: Request): Promise<AuthSession | null> {

  const url = new URL(req.url)

  if (isPublicPath(url.pathname)) return null



  if (isLocalhostBypass()) {

    return {

      user: { id: 'local', email: 'local@openjarvis' },

      session: { id: 'local', userId: 'local', expiresAt: new Date(Date.now() + 86_400_000) },

      via: 'localhost_bypass',

    }

  }



  const bearerToken = extractBearer(req)

  if (bearerToken?.startsWith('hrm_')) {

    try {

      const token = await apiTokensRepo.verify(bearerToken)

      if (token) {

        return {

          user: { id: 'api-token', email: 'api@openjarvis', name: token.name },

          session: {

            id: token.id,

            userId: 'api-token',

            expiresAt: new Date(Date.now() + 86_400_000),

          },

          via: 'api_token',

        }

      }

    } catch (err) {

      if (isDebugChannel('db')) {

        log.debug('API token verify failed', { error: err })

      } else {

        log.warn('API token verify failed', { error: err })

      }

    }

  }



  const session = await auth.api.getSession({ headers: req.headers })

  if (!session) return null

  return { ...(session as AuthSession), via: 'session' }

}



export async function guardRequest(req: Request): Promise<Response | null> {

  const url = new URL(req.url)

  if (url.pathname.startsWith('/api/auth')) return null

  if (isPublicPath(url.pathname)) return null

  if (isLocalhostBypass()) return null



  const session = await requireAuth(req)

  if (!session) {

    return Response.json({ error: 'Unauthorized', code: 'AUTH_ERROR' }, { status: 401 })

  }

  return null

}



export function oauthProvidersConfigured(): string[] {

  const names: string[] = []

  if (config.GITHUB_CLIENT_ID && config.GITHUB_CLIENT_SECRET) names.push('github')

  if (config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET) names.push('google')

  return names

}



export function authFeatures() {

  return {

    product: 'Open Jarvis',

    oauth: oauthProvidersConfigured(),

    ldap: ldapAuthConfigured(),

    totp: config.ENABLE_TOTP,

    allowSignup: config.ALLOW_SIGNUP,

    localhostBypass: isLocalhostBypass(),

    authRequired: authRequired(),

  }

}


