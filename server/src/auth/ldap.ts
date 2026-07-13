import { authenticate } from 'ldap-authentication'
import { credentials } from 'better-auth-credentials-plugin'
import { z } from 'zod'
import { APIError } from 'better-auth'
import type { User } from 'better-auth'
import { config } from '../config'
import { logger } from '../log'

const log = logger.child({ component: 'ldap-auth' })

export type LdapUser = User & {
  ldap_dn?: string
}

function ldapEmailFromResult(
  result: Record<string, unknown>,
  username: string,
): string {
  const mail = result.mail
  const raw =
    (Array.isArray(mail) ? mail[0] : mail) ??
    result.userPrincipalName ??
    result.uid ??
    username
  const email = String(raw ?? '').trim()
  if (email.includes('@')) return email.toLowerCase()
  const domain = config.LDAP_EMAIL_DOMAIN.trim()
  if (domain) return `${username}@${domain}`.toLowerCase()
  return `${username}@ldap.local`
}

function ldapTlsOptions(): Record<string, unknown> | undefined {
  if (!config.LDAP_URL.startsWith('ldaps://')) return undefined
  if (config.LDAP_TLS_REJECT_UNAUTHORIZED) return { minVersion: 'TLSv1.2' }
  return { minVersion: 'TLSv1.2', rejectUnauthorized: false }
}

/** Credentials plugin for `/api/auth/sign-in/ldap` when LDAP is enabled. */
export function buildLdapCredentialsPlugin() {
  if (!config.LDAP_ENABLED) return null
  if (!config.LDAP_URL.trim() || !config.LDAP_BASE_DN.trim()) {
    log.warn('LDAP_ENABLED but LDAP_URL or LDAP_BASE_DN is missing — LDAP login disabled')
    return null
  }

  return credentials({
    UserType: {} as LdapUser,
    providerId: 'ldap',
    autoSignUp: true,
    linkAccountIfExisting: true,
    path: '/sign-in/ldap',
    inputSchema: z.object({
      credential: z.string().min(1),
      password: z.string().min(1),
      rememberMe: z.boolean().optional(),
    }),
    async callback(_ctx, parsed) {
      try {
        const secure = config.LDAP_URL.startsWith('ldaps://')
        const ldapOpts: Record<string, unknown> = {
          url: config.LDAP_URL,
          connectTimeout: config.LDAP_TIMEOUT_MS,
          ...(secure ? { tlsOptions: ldapTlsOptions() } : {}),
        }

        const ldapResult = (await authenticate({
          ldapOpts,
          adminDn: config.LDAP_BIND_DN || undefined,
          adminPassword: config.LDAP_BIND_PASSWORD || undefined,
          userSearchBase: config.LDAP_BASE_DN,
          usernameAttribute: config.LDAP_USER_ATTRIBUTE,
          username: parsed.credential,
          userPassword: parsed.password,
        })) as Record<string, unknown>

        const username =
          String(ldapResult[config.LDAP_USER_ATTRIBUTE] ?? parsed.credential).trim() ||
          parsed.credential

        return {
          email: ldapEmailFromResult(ldapResult, username),
          name:
            String(ldapResult.displayName ?? ldapResult.cn ?? username).trim() || username,
          ldap_dn: typeof ldapResult.dn === 'string' ? ldapResult.dn : undefined,
          emailVerified: true,
        }
      } catch (err) {
        log.warn('LDAP authentication failed', {
          user: parsed.credential,
          error: String(err),
        })
        throw new APIError('UNAUTHORIZED', {
          message: 'Invalid username or password',
        })
      }
    },
  })
}

export function ldapAuthConfigured(): boolean {
  return Boolean(buildLdapCredentialsPlugin())
}
