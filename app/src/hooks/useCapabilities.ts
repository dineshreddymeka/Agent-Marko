import { useQuery } from '@tanstack/react-query'
import { apiClient, ApiError } from '@app/lib/api'
import type { CapabilitiesResponse } from '@hermes/shared'

export const CAPABILITIES_QUERY_KEY = ['capabilities'] as const

/** Fetch manifest; returns null when the endpoint is not deployed yet (404). */
export async function fetchCapabilities(): Promise<CapabilitiesResponse | null> {
  try {
    return await apiClient.get<CapabilitiesResponse>('/api/capabilities')
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null
    throw e
  }
}

export function useCapabilities() {
  return useQuery({
    queryKey: CAPABILITIES_QUERY_KEY,
    queryFn: fetchCapabilities,
    staleTime: 30_000,
    retry: false,
  })
}

export function isCapabilitiesManifestUnavailable(
  data: CapabilitiesResponse | null | undefined,
  isFetched: boolean,
  isError: boolean,
): boolean {
  return isFetched && !isError && data === null
}

/** True when agent tools are likely unavailable (degraded LLM route). */
export function isAgentLlmDegraded(agentLlm: CapabilitiesResponse['agentLlm']): boolean {
  if ('degraded' in agentLlm && typeof agentLlm.degraded === 'boolean') {
    return agentLlm.degraded
  }
  if (agentLlm.circuitState === 'open') return true
  if (agentLlm.lastHealthCheckAt && !agentLlm.lastHealthOk) return true
  return agentLlm.routing === 'capabilities' && !agentLlm.preferredAgentBaseUrl
}
