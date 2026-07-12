import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { config } from '../config'

export function officeSigningSecret(): Buffer {
  return createHash('sha256').update(config.BETTER_AUTH_SECRET).digest()
}

export function encryptSecret(value: unknown, secret = officeSigningSecret()): Record<string, string> {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', secret, iv)
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()])
  return {
    v: '1',
    alg: 'aes-256-gcm',
    iv: iv.toString('base64url'),
    tag: cipher.getAuthTag().toString('base64url'),
    data: encrypted.toString('base64url'),
  }
}

export function decryptSecret<T>(value: unknown, secret = officeSigningSecret()): T | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  if (record.v !== '1' || record.alg !== 'aes-256-gcm') return null
  if (
    typeof record.iv !== 'string' ||
    typeof record.tag !== 'string' ||
    typeof record.data !== 'string'
  ) {
    return null
  }
  try {
    const decipher = createDecipheriv('aes-256-gcm', secret, Buffer.from(record.iv, 'base64url'))
    decipher.setAuthTag(Buffer.from(record.tag, 'base64url'))
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(record.data, 'base64url')),
      decipher.final(),
    ])
    return JSON.parse(decrypted.toString('utf8')) as T
  } catch {
    return null
  }
}

export type OfficeState = {
  nonce: string
  exp: number
  returnTo: string
}

export function signOfficeState(payload: OfficeState, secret = officeSigningSecret()): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const sig = createHmac('sha256', secret).update(body).digest('base64url')
  return `${body}.${sig}`
}

export function verifyOfficeState(state: string | null, secret = officeSigningSecret()): OfficeState | null {
  if (!state) return null
  const [body, sig] = state.split('.')
  if (!body || !sig) return null
  const expected = createHmac('sha256', secret).update(body).digest('base64url')
  try {
    const a = Buffer.from(sig)
    const b = Buffer.from(expected)
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  } catch {
    return null
  }
  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as OfficeState
    if (!parsed.nonce || typeof parsed.returnTo !== 'string' || typeof parsed.exp !== 'number') return null
    if (parsed.exp < Date.now()) return null
    return parsed
  } catch {
    return null
  }
}
