/**
 * Quick LDAP connectivity check — does not store credentials.
 *
 * Usage (from repo root):
 *   bun run server/scripts/ldap-probe.ts
 *   bun run server/scripts/ldap-probe.ts alice your-password
 */
import { authenticate } from 'ldap-authentication'
import { config } from '../src/config'

async function main() {
  if (!config.LDAP_ENABLED) {
    console.error('LDAP_ENABLED is not set — enable it in .env first.')
    process.exit(1)
  }
  if (!config.LDAP_URL.trim() || !config.LDAP_BASE_DN.trim()) {
    console.error('LDAP_URL and LDAP_BASE_DN are required.')
    process.exit(1)
  }

  const username = process.argv[2]?.trim()
  const password = process.argv[3]
  if (!username || !password) {
    console.error('Usage: bun run server/scripts/ldap-probe.ts <username> <password>')
    process.exit(1)
  }

  const secure = config.LDAP_URL.startsWith('ldaps://')
  const ldapOpts: Record<string, unknown> = {
    url: config.LDAP_URL,
    connectTimeout: config.LDAP_TIMEOUT_MS,
    ...(secure
      ? {
          tlsOptions: config.LDAP_TLS_REJECT_UNAUTHORIZED
            ? { minVersion: 'TLSv1.2' }
            : { minVersion: 'TLSv1.2', rejectUnauthorized: false },
        }
      : {}),
  }

  const result = (await authenticate({
    ldapOpts,
    adminDn: config.LDAP_BIND_DN || undefined,
    adminPassword: config.LDAP_BIND_PASSWORD || undefined,
    userSearchBase: config.LDAP_BASE_DN,
    usernameAttribute: config.LDAP_USER_ATTRIBUTE,
    username,
    userPassword: password,
  })) as Record<string, unknown>

  const mail = result.mail
  const email =
    (Array.isArray(mail) ? mail[0] : mail) ??
    result.userPrincipalName ??
    `${username}@${config.LDAP_EMAIL_DOMAIN || 'ldap.local'}`

  console.log('LDAP bind OK')
  console.log({
    dn: result.dn,
    username: result[config.LDAP_USER_ATTRIBUTE],
    email: String(email),
    displayName: result.displayName ?? result.cn,
  })
}

main().catch((err) => {
  console.error('LDAP probe failed:', String(err))
  process.exit(1)
})
