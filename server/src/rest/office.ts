import { createHash, randomBytes } from 'node:crypto'
import { config } from '../config'
import {
  buildBriefingFromEvents,
  resolveDayBounds,
  tokenExpiresAtMs,
  type GraphEvent,
} from '../office/briefing'
import { decryptSecret, encryptSecret, signOfficeState, verifyOfficeState } from '../office/crypto'
import { requireDatabaseOrResponse, withDatabase } from './db-guard'
import { jsonResponse, parseJson } from './helpers'

/**
 * Microsoft Graph Office OAuth — aligned with:
 * - https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow
 * - https://learn.microsoft.com/en-us/graph/auth-v2-user
 * - https://learn.microsoft.com/en-us/graph/api/user-list-calendarview
 *
 * Architecture: confidential web app (server stores client_secret) + auth code + PKCE.
 * Azure app registration platform must be "Web" (not SPA), redirect =
 *   {BETTER_AUTH_URL}/api/office/callback
 */

const TOKEN_SETTING_KEY = 'office_graph_token'
const ACCOUNT_SETTING_KEY = 'office_graph_account'
const PENDING_KEY_PREFIX = 'office_oauth_pending:'
const STATE_TTL_MS = 10 * 60_000

/** Core delegated scopes for live calendar briefing (user consent). */
const CORE_SCOPES = ['offline_access', 'User.Read', 'Calendars.Read', 'OnlineMeetings.Read'] as const

/**
 * Artifact scopes often need tenant admin consent. Requested only with prompt=consent
 * after core connect succeeds — requesting them on first login commonly blocks OAuth.
 */
const ARTIFACT_SCOPES = [
  'OnlineMeetingArtifact.Read.All',
  'OnlineMeetingTranscript.Read.All',
] as const

type PendingAuth = {
  verifier: string
  returnTo: string
  expiresAt: number
  scopes: string[]
}

type TokenPayload = {
  token_type: string
  scope?: string
  expires_in?: number
  access_token: string
  refresh_token?: string
  id_token?: string
  storedAt?: string
  expiresAt?: string
}

type GraphUser = {
  id?: string
  displayName?: string
  mail?: string
  userPrincipalName?: string
}

type SettingsRepo = {
  get: (key: string) => Promise<unknown | null>
  set: (key: string, value: unknown) => Promise<void>
  delete: (key: string) => Promise<boolean>
}

function redirectUri(): string {
  return config.MICROSOFT_REDIRECT_URI ?? `${config.BETTER_AUTH_URL}/api/office/callback`
}

function tenantId(): string {
  const t = config.MICROSOFT_TENANT_ID?.trim()
  return t && t.length > 0 ? t : 'organizations'
}

function microsoftConfigured(): boolean {
  return Boolean(config.MICROSOFT_CLIENT_ID?.trim() && config.MICROSOFT_CLIENT_SECRET?.trim())
}

/** Env keys still empty — used by UI so users know exactly what to set. */
function microsoftMissingEnv(): string[] {
  const missing: string[] = []
  if (!config.MICROSOFT_CLIENT_ID?.trim()) missing.push('MICROSOFT_CLIENT_ID')
  if (!config.MICROSOFT_CLIENT_SECRET?.trim()) missing.push('MICROSOFT_CLIENT_SECRET')
  return missing
}

function officeConfigPayload() {
  const missingEnv = microsoftMissingEnv()
  return {
    configured: missingEnv.length === 0,
    missingEnv,
    redirectUri: redirectUri(),
    tenantId: tenantId(),
    autoSso: config.MICROSOFT_SSO_AUTO,
    azurePlatform: 'Web' as const,
    flow: 'authorization_code+pkce' as const,
    /** Microsoft Graph calendar SSO — independent of Open Cowork desktop. */
    purpose: 'microsoft_graph_office_briefing',
    scopes: [...CORE_SCOPES],
  }
}

function requireConfidentialClient(): void {
  if (!config.MICROSOFT_CLIENT_ID?.trim()) {
    throw new Error('MICROSOFT_CLIENT_ID is not configured.')
  }
  if (!config.MICROSOFT_CLIENT_SECRET?.trim()) {
    throw new Error(
      'MICROSOFT_CLIENT_SECRET is required for confidential Web apps (Microsoft identity platform).',
    )
  }
}

function officeFallbackReturnTo(): string {
  try {
    const auth = new URL(config.BETTER_AUTH_URL)
    if (auth.hostname === '127.0.0.1' || auth.hostname === 'localhost') {
      return `http://${auth.hostname}:5173/panel/briefing`
    }
    return new URL('/panel/briefing', config.BETTER_AUTH_URL).toString()
  } catch {
    return 'http://127.0.0.1:5173/panel/briefing'
  }
}

function isAllowedReturnOrigin(origin: string, req: Request): boolean {
  try {
    if (origin === new URL(config.BETTER_AUTH_URL).origin) return true
  } catch {
    // ignore
  }
  if (origin === 'http://127.0.0.1:5173' || origin === 'http://localhost:5173') return true
  const requestOrigin = req.headers.get('Origin')
  if (requestOrigin !== origin) return false
  try {
    const host = new URL(origin).hostname
    return host === '127.0.0.1' || host === 'localhost'
  } catch {
    return false
  }
}

function safeReturnTo(value: unknown, req: Request): string {
  const fallback = officeFallbackReturnTo()
  if (typeof value !== 'string' || !value.trim()) return fallback
  try {
    const base = req.headers.get('Origin') ?? config.BETTER_AUTH_URL
    const url =
      value.startsWith('/') && !value.startsWith('//') ? new URL(value, base) : new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return fallback
    if (!isAllowedReturnOrigin(url.origin, req)) return fallback
    url.searchParams.delete('office')
    url.searchParams.delete('message')
    url.hash = ''
    // Always land on Briefing panel path (Microsoft calendar)
    if (!url.pathname.includes('/panel/briefing')) {
      url.pathname = '/panel/briefing'
    }
    return url.toString()
  } catch {
    return fallback
  }
}

async function savePending(settingsRepo: SettingsRepo, nonce: string, pending: PendingAuth) {
  await settingsRepo.set(`${PENDING_KEY_PREFIX}${nonce}`, encryptSecret(pending))
}

async function takePending(settingsRepo: SettingsRepo, nonce: string): Promise<PendingAuth | null> {
  const key = `${PENDING_KEY_PREFIX}${nonce}`
  const sealed = await settingsRepo.get(key)
  await settingsRepo.delete(key).catch(() => false)
  const pending = decryptSecret<PendingAuth>(sealed)
  if (!pending?.verifier || !pending.returnTo || !pending.expiresAt) return null
  if (pending.expiresAt < Date.now()) return null
  return pending
}

async function buildAuthUrl(
  settingsRepo: SettingsRepo,
  returnTo: string,
  options: { prompt?: 'select_account' | 'consent'; includeArtifacts?: boolean } = {},
): Promise<string> {
  requireConfidentialClient()
  const clientId = config.MICROSOFT_CLIENT_ID!.trim()

  const nonce = randomBytes(18).toString('base64url')
  const verifier = randomBytes(48).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  const expiresAt = Date.now() + STATE_TTL_MS
  const scopes = options.includeArtifacts
    ? [...CORE_SCOPES, ...ARTIFACT_SCOPES]
    : [...CORE_SCOPES]

  await savePending(settingsRepo, nonce, {
    verifier,
    returnTo,
    expiresAt,
    scopes,
  })

  const state = signOfficeState({ nonce, exp: expiresAt, returnTo })
  const url = new URL(`https://login.microsoftonline.com/${tenantId()}/oauth2/v2.0/authorize`)
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('redirect_uri', redirectUri())
  url.searchParams.set('response_mode', 'query')
  url.searchParams.set('scope', scopes.join(' '))
  url.searchParams.set('state', state)
  url.searchParams.set('code_challenge', challenge)
  url.searchParams.set('code_challenge_method', 'S256')
  url.searchParams.set('prompt', options.prompt ?? 'select_account')
  return url.toString()
}

async function postToken(body: URLSearchParams): Promise<TokenPayload> {
  const res = await fetch(`https://login.microsoftonline.com/${tenantId()}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  const payload = (await res.json().catch(() => ({}))) as Partial<TokenPayload> & {
    error?: string
    error_description?: string
  }
  if (!res.ok || !payload.access_token) {
    throw new Error(payload.error_description ?? payload.error ?? 'Microsoft token request failed.')
  }
  return payload as TokenPayload
}

async function exchangeCode(code: string, verifier: string, scopes: string[]): Promise<TokenPayload> {
  requireConfidentialClient()
  const body = new URLSearchParams()
  body.set('client_id', config.MICROSOFT_CLIENT_ID!.trim())
  body.set('client_secret', config.MICROSOFT_CLIENT_SECRET!.trim())
  body.set('grant_type', 'authorization_code')
  body.set('code', code)
  body.set('redirect_uri', redirectUri())
  body.set('scope', scopes.join(' '))
  body.set('code_verifier', verifier)
  return postToken(body)
}

async function refreshAccessToken(refreshToken: string): Promise<TokenPayload> {
  requireConfidentialClient()
  const body = new URLSearchParams()
  body.set('client_id', config.MICROSOFT_CLIENT_ID!.trim())
  body.set('client_secret', config.MICROSOFT_CLIENT_SECRET!.trim())
  body.set('grant_type', 'refresh_token')
  body.set('refresh_token', refreshToken)
  body.set('scope', [...CORE_SCOPES, ...ARTIFACT_SCOPES].join(' '))
  const payload = await postToken(body)
  return { ...payload, refresh_token: payload.refresh_token ?? refreshToken }
}

async function fetchGraphUser(accessToken: string): Promise<GraphUser | null> {
  const res = await fetch('https://graph.microsoft.com/v1.0/me', {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) return null
  return (await res.json()) as GraphUser
}

async function getValidAccessToken(
  settingsRepo: SettingsRepo,
): Promise<{ accessToken: string; token: TokenPayload } | null> {
  const encrypted = await settingsRepo.get(TOKEN_SETTING_KEY)
  const token = decryptSecret<TokenPayload>(encrypted)
  if (!token?.access_token) return null

  const expiresAt = tokenExpiresAtMs(token)
  if (expiresAt === null || expiresAt > Date.now() + 60_000) {
    return { accessToken: token.access_token, token }
  }
  if (!token.refresh_token) return null

  const refreshed = await refreshAccessToken(token.refresh_token)
  const nextExpiresAt =
    typeof refreshed.expires_in === 'number'
      ? new Date(Date.now() + refreshed.expires_in * 1000).toISOString()
      : undefined
  const nextToken: TokenPayload = {
    ...refreshed,
    storedAt: new Date().toISOString(),
    expiresAt: nextExpiresAt,
  }
  await settingsRepo.set(TOKEN_SETTING_KEY, encryptSecret(nextToken))
  return { accessToken: nextToken.access_token, token: nextToken }
}

/**
 * calendarView paging: follow @odata.nextLink and re-apply Prefer on each page
 * (Microsoft Graph does not preserve custom headers on nextLink alone).
 */
async function fetchTodayEvents(
  accessToken: string,
  start: Date,
  end: Date,
): Promise<GraphEvent[]> {
  const first = new URL('https://graph.microsoft.com/v1.0/me/calendarView')
  first.searchParams.set('startDateTime', start.toISOString())
  first.searchParams.set('endDateTime', end.toISOString())
  first.searchParams.set('$orderby', 'start/dateTime')
  first.searchParams.set('$top', '50')
  first.searchParams.set(
    '$select',
    'id,subject,start,end,isCancelled,isOnlineMeeting,onlineMeeting,location,attendees',
  )

  const headers = {
    Authorization: `Bearer ${accessToken}`,
    // Docs: Prefer outlook.timezone uses Windows TZ names; UTC keeps parsing deterministic.
    Prefer: 'outlook.timezone="UTC"',
  }

  const events: GraphEvent[] = []
  let nextUrl: string | null = first.toString()
  let pages = 0

  while (nextUrl && pages < 10) {
    pages += 1
    const res = await fetch(nextUrl, { headers })
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
      throw new Error(body.error?.message ?? `Graph calendarView failed (${res.status})`)
    }
    const payload = (await res.json()) as { value?: GraphEvent[]; '@odata.nextLink'?: string }
    if (Array.isArray(payload.value)) events.push(...payload.value)
    nextUrl = payload['@odata.nextLink'] ?? null
  }

  return events
}

function withOfficeResult(returnTo: string, result: 'connected' | 'error', message?: string): Response {
  let url: URL
  try {
    url = new URL(returnTo)
  } catch {
    url = new URL(officeFallbackReturnTo())
  }
  url.searchParams.set('office', result)
  if (message) url.searchParams.set('message', message.slice(0, 160))
  return Response.redirect(url.toString(), 302)
}

function emptyBriefing(partial: Record<string, unknown>) {
  return {
    live: false,
    connected: false,
    configured: microsoftConfigured(),
    account: null,
    stats: null,
    agenda: [],
    insights: [],
    actions: [],
    ...partial,
  }
}

export async function handleOffice(req: Request, path: string): Promise<Response | null> {
  const { settingsRepo } = await import('../db/repositories/settings')
  const parts = path.split('/').filter(Boolean)
  if (parts[0] !== 'api' || parts[1] !== 'office') return null

  // Public: whether Microsoft Graph OAuth env is set (no secrets / connection state).
  if (req.method === 'GET' && parts.length === 3 && parts[2] === 'config') {
    return jsonResponse(officeConfigPayload())
  }

  if (req.method === 'GET' && parts.length === 3 && parts[2] === 'status') {
    const account = await withDatabase(() => settingsRepo.get(ACCOUNT_SETTING_KEY), null)
    const token = await withDatabase(() => settingsRepo.get(TOKEN_SETTING_KEY), null)
    const decrypted = decryptSecret<TokenPayload>(token)
    const granted = decrypted?.scope?.split(/\s+/).filter(Boolean) ?? []
    const cfg = officeConfigPayload()
    return jsonResponse({
      ...cfg,
      connected: Boolean(account && decrypted?.access_token),
      account: account ?? null,
      artifactScopes: [...ARTIFACT_SCOPES],
      grantedScopes: granted,
    })
  }

  // Bookmark / login / script entry: immediate redirect into Microsoft SSO
  if (req.method === 'GET' && parts.length === 3 && parts[2] === 'sso') {
    const unavailable = await requireDatabaseOrResponse()
    if (unavailable) return unavailable
    const url = new URL(req.url)
    const returnTo = safeReturnTo(url.searchParams.get('returnTo'), req)
    const missing = microsoftMissingEnv()
    if (missing.length > 0) {
      return jsonResponse(
        {
          error: `Microsoft SSO is not configured. Set ${missing.join(' and ')} in the server .env, register the Azure Web redirect URI, then restart.`,
          code: 'OFFICE_NOT_CONFIGURED',
          missingEnv: missing,
          redirectUri: redirectUri(),
          hint: 'Run: bun run office:sso-setup   (or paste Client ID/Secret from Entra App registrations). Open Cowork.exe is NOT required for Microsoft sign-in.',
        },
        400,
      )
    }
    try {
      const authUrl = await buildAuthUrl(settingsRepo, returnTo, {
        prompt: 'select_account',
        includeArtifacts: false,
      })
      return Response.redirect(authUrl, 302)
    } catch (err) {
      return jsonResponse(
        {
          error: err instanceof Error ? err.message : 'Microsoft OAuth is not configured.',
          code: 'OFFICE_NOT_CONFIGURED',
          missingEnv: microsoftMissingEnv(),
        },
        400,
      )
    }
  }

  if ((req.method === 'POST' || req.method === 'GET') && parts.length === 3 && parts[2] === 'connect') {
    const unavailable = await requireDatabaseOrResponse()
    if (unavailable) return unavailable

    const url = new URL(req.url)
    const body = req.method === 'POST' ? await parseJson<Record<string, unknown>>(req) : null
    const returnTo =
      req.method === 'GET'
        ? safeReturnTo(url.searchParams.get('returnTo'), req)
        : safeReturnTo(body?.returnTo, req)
    const promptRaw =
      req.method === 'GET'
        ? url.searchParams.get('prompt')
        : typeof body?.prompt === 'string'
          ? body.prompt
          : null
    const prompt = promptRaw === 'consent' ? 'consent' : 'select_account'
    const includeArtifacts =
      req.method === 'GET'
        ? url.searchParams.get('artifacts') === '1'
        : body?.artifacts === true || body?.artifacts === '1'

    try {
      const authUrl = await buildAuthUrl(settingsRepo, returnTo, { prompt, includeArtifacts })
      if (req.method === 'GET') return Response.redirect(authUrl, 302)
      return jsonResponse({ authUrl })
    } catch (err) {
      const missing = microsoftMissingEnv()
      return jsonResponse(
        {
          error: err instanceof Error ? err.message : 'Microsoft OAuth is not configured.',
          code: 'OFFICE_NOT_CONFIGURED',
          missingEnv: missing,
          redirectUri: redirectUri(),
          hint:
            missing.length > 0
              ? `Set ${missing.join(' + ')} in .env, Azure Web redirect URI must be exactly ${redirectUri()}, then restart. Open Cowork.exe is not required for SSO.`
              : 'Register an Entra Web app, set MICROSOFT_CLIENT_ID + MICROSOFT_CLIENT_SECRET, redirect URI must match exactly.',
        },
        400,
      )
    }
  }

  if (req.method === 'GET' && parts.length === 3 && parts[2] === 'callback') {
    const url = new URL(req.url)
    const state = verifyOfficeState(url.searchParams.get('state'))
    const code = url.searchParams.get('code')
    const error = url.searchParams.get('error_description') ?? url.searchParams.get('error')
    const returnTo = state?.returnTo ?? officeFallbackReturnTo()

    if (error) return withOfficeResult(returnTo, 'error', error)
    if (!state || !code) return withOfficeResult(returnTo, 'error', 'Invalid Microsoft callback state.')

    const unavailable = await requireDatabaseOrResponse()
    if (unavailable) return unavailable

    const pending = await takePending(settingsRepo, state.nonce)
    if (!pending) {
      return withOfficeResult(returnTo, 'error', 'Microsoft sign-in expired. Try connecting again.')
    }

    try {
      const token = await exchangeCode(code, pending.verifier, pending.scopes)
      const account = await fetchGraphUser(token.access_token)
      const expiresAt =
        typeof token.expires_in === 'number'
          ? new Date(Date.now() + token.expires_in * 1000).toISOString()
          : null

      await settingsRepo.set(
        TOKEN_SETTING_KEY,
        encryptSecret({
          ...token,
          storedAt: new Date().toISOString(),
          expiresAt: expiresAt ?? undefined,
        }),
      )
      await settingsRepo.set(ACCOUNT_SETTING_KEY, {
        id: account?.id ?? null,
        displayName: account?.displayName ?? null,
        email: account?.mail ?? account?.userPrincipalName ?? null,
        connectedAt: new Date().toISOString(),
        expiresAt,
        scopes: token.scope?.split(/\s+/).filter(Boolean) ?? pending.scopes,
      })

      return withOfficeResult(pending.returnTo, 'connected')
    } catch (err) {
      return withOfficeResult(
        pending.returnTo,
        'error',
        err instanceof Error ? err.message : 'Microsoft connect failed.',
      )
    }
  }

  if (req.method === 'POST' && parts.length === 3 && parts[2] === 'disconnect') {
    const unavailable = await requireDatabaseOrResponse()
    if (unavailable) return unavailable
    await settingsRepo.delete(TOKEN_SETTING_KEY)
    await settingsRepo.delete(ACCOUNT_SETTING_KEY)
    return jsonResponse({ connected: false })
  }

  if (req.method === 'GET' && parts.length === 3 && parts[2] === 'briefing') {
    const unavailable = await requireDatabaseOrResponse()
    if (unavailable) return unavailable

    if (!microsoftConfigured()) {
      return jsonResponse(
        emptyBriefing({
          message:
            'Set MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET, register Azure Web redirect URI, then restart.',
        }),
      )
    }

    const account = await settingsRepo.get(ACCOUNT_SETTING_KEY)
    let access: { accessToken: string; token: TokenPayload } | null = null
    try {
      access = await getValidAccessToken(settingsRepo)
    } catch (err) {
      return jsonResponse(
        emptyBriefing({
          connected: Boolean(account),
          account,
          error: err instanceof Error ? err.message : 'Could not refresh Microsoft token.',
          message: 'Reconnect Microsoft to refresh Graph access.',
        }),
        401,
      )
    }

    if (!access) {
      return jsonResponse(
        emptyBriefing({
          message: 'Connect Microsoft to pull today’s live calendar briefing from Graph.',
        }),
      )
    }

    const url = new URL(req.url)
    const { start, end } = resolveDayBounds({
      start: url.searchParams.get('start'),
      end: url.searchParams.get('end'),
    })
    const timeZone = url.searchParams.get('tz') ?? undefined

    try {
      const events = await fetchTodayEvents(access.accessToken, start, end)
      return jsonResponse(buildBriefingFromEvents(events, account, new Date(), timeZone))
    } catch (err) {
      return jsonResponse(
        emptyBriefing({
          connected: true,
          account,
          error: err instanceof Error ? err.message : 'Graph calendar sync failed.',
          message: 'Connected, but Microsoft Graph calendar could not be loaded.',
        }),
        502,
      )
    }
  }

  return null
}
