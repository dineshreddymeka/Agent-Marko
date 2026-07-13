import { describe, expect, test } from 'bun:test'
import { buildLdapCredentialsPlugin } from '../src/auth/ldap'

describe('LDAP auth plugin', () => {
  test('buildLdapCredentialsPlugin returns null when LDAP disabled', () => {
    const prev = process.env.LDAP_ENABLED
    process.env.LDAP_ENABLED = '0'
    expect(buildLdapCredentialsPlugin()).toBeNull()
    process.env.LDAP_ENABLED = prev
  })
})
