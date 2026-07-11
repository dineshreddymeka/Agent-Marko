import type { RunAgentInput } from '@ag-ui/core'
import type { Profile } from '@hermes/shared'
import { profilesRepo } from '../db/repositories/profiles'
import { sessionsRepo } from '../db/repositories/sessions'
import { ProviderError } from '../errors'
import type { EventEmitter } from '../agui/events'
import { nativeProvider } from './providers/native'
import { aguiRemoteProvider } from './providers/agui-remote'
import { hermesPythonProvider } from './providers/hermes-python'

export interface AgentProvider {
  readonly id: Profile['provider']
  run(input: RunAgentInput, emit: EventEmitter, signal: AbortSignal): Promise<void>
}

const registry = new Map<Profile['provider'], AgentProvider>([
  ['native', nativeProvider],
  ['agui-remote', aguiRemoteProvider],
  ['hermes-python', hermesPythonProvider],
])

export function getProvider(id: Profile['provider']): AgentProvider | undefined {
  return registry.get(id)
}

export function registerProvider(provider: AgentProvider): void {
  registry.set(provider.id, provider)
}

export function listProviders(): Profile['provider'][] {
  return [...registry.keys()]
}

export async function resolveProvider(input: RunAgentInput): Promise<AgentProvider> {
  const session = await sessionsRepo.getById(input.threadId)
  let profile: Profile | null = null
  if (session?.profileId) {
    profile = await profilesRepo.getById(session.profileId)
  }
  if (!profile) {
    profile = await profilesRepo.getDefault()
  }
  if (!profile) {
    throw new ProviderError('No profile configured')
  }
  const provider = getProvider(profile.provider)
  if (!provider) {
    throw new ProviderError(`Unknown provider: ${profile.provider}`)
  }
  return provider
}

export async function resolveProviderById(id: Profile['provider']): Promise<AgentProvider> {
  const provider = getProvider(id)
  if (!provider) {
    throw new ProviderError(`Unknown provider: ${id}`)
  }
  return provider
}
