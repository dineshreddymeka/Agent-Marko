/**
 * Provider delegation capability surface — availability for manifest + delegate_to_agent.
 */
import type { Profile } from '@hermes/shared'
import { config } from '../config'
import { ProviderError } from '../errors'
import { getProvider, listProviders, type AgentProvider } from './provider'

export type ProviderId = Profile['provider']

export const KNOWN_PROVIDER_IDS: readonly ProviderId[] = [
  'native',
  'agui-remote',
  'hermes-python',
] as const

export type CapabilityProviderStatus = 'available' | 'unavailable' | 'misconfigured'

export type CapabilityProviderEntry = {
  id: ProviderId
  label: string
  available: boolean
  status: CapabilityProviderStatus
  reason: string | null
  /** Whether `delegate_to_agent` may target this provider when available. */
  delegatable: boolean
}

export type ProviderValidationFailure = {
  ok: false
  result: {
    error: string
    code: 'PROVIDER_UNSUPPORTED' | 'PROVIDER_UNAVAILABLE' | 'VALIDATION_ERROR'
    provider: string | null
    available: ProviderId[]
  }
}

export type ProviderValidationSuccess = {
  ok: true
  providerId: ProviderId
  provider: AgentProvider
}

export type ProviderValidationResult = ProviderValidationFailure | ProviderValidationSuccess

const LABELS: Record<ProviderId, string> = {
  native: 'Native Open Jarvis',
  'agui-remote': 'Remote AG-UI',
  'hermes-python': 'Hermes Python bridge',
}

type AvailabilityOverride = Partial<Record<ProviderId, boolean>>
let availabilityOverrides: AvailabilityOverride | null = null
let aguiRemoteConfiguredCheck: (() => Promise<boolean>) | null = null

export function setProviderAvailabilityOverridesForTests(overrides: AvailabilityOverride | null): void {
  availabilityOverrides = overrides
}

export function setAguiRemoteConfiguredCheckForTests(fn: (() => Promise<boolean>) | null): void {
  aguiRemoteConfiguredCheck = fn
}

export function isKnownProviderId(value: unknown): value is ProviderId {
  return typeof value === 'string' && (KNOWN_PROVIDER_IDS as readonly string[]).includes(value)
}

function hermesPythonConfigured(): boolean {
  if (availabilityOverrides && typeof availabilityOverrides['hermes-python'] === 'boolean') {
    return availabilityOverrides['hermes-python']
  }
  const fromEnv = (process.env.HERMES_PYTHON_URL ?? '').trim()
  const fromConfig = (config.HERMES_PYTHON_URL ?? '').trim()
  return Boolean(fromEnv || fromConfig)
}

async function defaultAguiRemoteConfigured(): Promise<boolean> {
  if (availabilityOverrides && typeof availabilityOverrides['agui-remote'] === 'boolean') {
    return availabilityOverrides['agui-remote']
  }
  if (aguiRemoteConfiguredCheck) return aguiRemoteConfiguredCheck()
  try {
    const { pingDatabase } = await import('../db/client')
    const reachable = await Promise.race([
      pingDatabase(),
      Bun.sleep(1500).then(() => false),
    ])
    if (!reachable) return false
    const { profilesRepo } = await import('../db/repositories/profiles')
    const profiles = await Promise.race([
      profilesRepo.list(),
      Bun.sleep(2000).then(() => [] as Profile[]),
    ])
    return profiles.some((p) => {
      const endpoint = (p.providerConfig as { endpoint?: unknown } | null)?.endpoint
      return typeof endpoint === 'string' && endpoint.trim().length > 0
    })
  } catch {
    return false
  }
}

/** Session-scoped: prefer the session profile endpoint, else any configured profile. */
async function sessionHasAguiRemoteEndpoint(sessionId?: string): Promise<boolean> {
  if (availabilityOverrides && typeof availabilityOverrides['agui-remote'] === 'boolean') {
    return availabilityOverrides['agui-remote']
  }
  try {
    const { sessionsRepo } = await import('../db/repositories/sessions')
    const { profilesRepo } = await import('../db/repositories/profiles')
    if (sessionId) {
      const session = await sessionsRepo.getById(sessionId)
      if (session?.profileId) {
        const profile = await profilesRepo.getById(session.profileId)
        const endpoint = (profile?.providerConfig as { endpoint?: unknown } | null)?.endpoint
        if (typeof endpoint === 'string' && endpoint.trim()) return true
      }
    }
    const fallback = await profilesRepo.getDefault()
    const endpoint = (fallback?.providerConfig as { endpoint?: unknown } | null)?.endpoint
    if (typeof endpoint === 'string' && endpoint.trim()) return true
    return defaultAguiRemoteConfigured()
  } catch {
    return defaultAguiRemoteConfigured()
  }
}

export async function buildProviderCapabilityEntries(): Promise<CapabilityProviderEntry[]> {
  const registered = new Set(listProviders())
  const aguiOk = await defaultAguiRemoteConfigured()
  const pythonOk = hermesPythonConfigured()

  return KNOWN_PROVIDER_IDS.map((id) => {
    const inRegistry = registered.has(id)
    if (!inRegistry) {
      return {
        id,
        label: LABELS[id],
        available: false,
        status: 'unavailable' as const,
        reason: 'Provider is not registered',
        delegatable: true,
      }
    }
    if (id === 'native') {
      const forced = availabilityOverrides?.native
      const available = typeof forced === 'boolean' ? forced : true
      return {
        id,
        label: LABELS[id],
        available,
        status: available ? 'available' : 'unavailable',
        reason: available ? null : 'Disabled by operator override',
        delegatable: true,
      }
    }
    if (id === 'hermes-python') {
      return {
        id,
        label: LABELS[id],
        available: pythonOk,
        status: pythonOk ? 'available' : 'misconfigured',
        reason: pythonOk ? null : 'Set HERMES_PYTHON_URL to enable the Hermes Python bridge',
        delegatable: true,
      }
    }
    // agui-remote
    return {
      id,
      label: LABELS[id],
      available: aguiOk,
      status: aguiOk ? 'available' : 'misconfigured',
      reason: aguiOk
        ? null
        : 'Configure a profile providerConfig.endpoint for agui-remote delegation',
      delegatable: true,
    }
  })
}

export function availableProviderIds(entries: CapabilityProviderEntry[]): ProviderId[] {
  return entries.filter((e) => e.available && e.delegatable).map((e) => e.id)
}

export async function validateDelegationProvider(
  rawProvider: unknown,
  opts?: { sessionId?: string },
): Promise<ProviderValidationResult> {
  const entries = await buildProviderCapabilityEntries()
  const available = availableProviderIds(entries)

  if (typeof rawProvider !== 'string' || !rawProvider.trim()) {
    return {
      ok: false,
      result: {
        error: 'provider is required',
        code: 'VALIDATION_ERROR',
        provider: null,
        available,
      },
    }
  }

  const providerId = rawProvider.trim()
  if (!isKnownProviderId(providerId) || !getProvider(providerId)) {
    return {
      ok: false,
      result: {
        error: `Unsupported provider: ${providerId}. Supported: ${KNOWN_PROVIDER_IDS.join(', ')}`,
        code: 'PROVIDER_UNSUPPORTED',
        provider: providerId,
        available,
      },
    }
  }

  // Session-aware check for agui-remote endpoint
  let entry = entries.find((e) => e.id === providerId)!
  if (providerId === 'agui-remote') {
    const ok = await sessionHasAguiRemoteEndpoint(opts?.sessionId)
    entry = {
      ...entry,
      available: ok,
      status: ok ? 'available' : 'misconfigured',
      reason: ok
        ? null
        : 'agui-remote requires providerConfig.endpoint on the session or default profile',
    }
  }

  if (!entry.available) {
    return {
      ok: false,
      result: {
        error: `Provider unavailable: ${providerId}${entry.reason ? ` — ${entry.reason}` : ''}`,
        code: 'PROVIDER_UNAVAILABLE',
        provider: providerId,
        available,
      },
    }
  }

  const provider = getProvider(providerId)
  if (!provider) {
    return {
      ok: false,
      result: {
        error: `Unsupported provider: ${providerId}`,
        code: 'PROVIDER_UNSUPPORTED',
        provider: providerId,
        available,
      },
    }
  }

  return { ok: true, providerId, provider }
}

const SECRET_PATTERNS: RegExp[] = [
  /authorization:\s*Bearer\s+\S+/gi,
  /Bearer\s+[A-Za-z0-9\-._~+/]+=*/g,
  /api[_-]?key["']?\s*[:=]\s*["']?[^"'\s]+/gi,
  /HERMES_PYTHON_AUTH["']?\s*[:=]\s*["']?[^"'\s]+/gi,
]

/** Strip secrets / overly long payloads from nested provider errors. */
export function sanitizeProviderError(err: unknown): { message: string; code: string } {
  let message: string
  let code = 'PROVIDER_ERROR'
  if (err instanceof ProviderError) {
    message = err.message
    code = err.code
  } else if (err instanceof Error) {
    message = err.message
  } else {
    message = String(err)
  }
  for (const pattern of SECRET_PATTERNS) {
    message = message.replace(pattern, '[redacted]')
  }
  // Avoid leaking full request bodies or huge stack dumps in tool results.
  message = message.replace(/\s+/g, ' ').trim().slice(0, 500)
  return { message, code }
}
