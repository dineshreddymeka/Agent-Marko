import { isMockLlmEnabled } from './agent/mock-llm'
import { config } from './config'
import { pingDatabase } from './db/client'

export const VERSION = '0.1.0'

export interface HealthResponse {
  ok: boolean
  version: string
  db: boolean
  llm: {
    mode: 'mock' | 'live'
    mock: boolean
    model: string | null
  }
  /** Configured better-auth social providers (names only — no secrets). */
  oauthProviders: string[]
}

/** Public `/api/health` — no secrets (LLM base URL lives on debug health). */
export async function getHealthResponse(): Promise<HealthResponse> {
  const db = await pingDatabase()
  const mock = isMockLlmEnabled()
  let model: string | null = mock ? 'mock' : null
  if (!mock && db) {
    try {
      const { profilesRepo } = await import('./db/repositories/profiles')
      const profile = await profilesRepo.getDefault()
      model = profile?.model ?? null
    } catch {
      model = null
    }
  }
  const { oauthProvidersConfigured } = await import('./auth')
  return {
    ok: true,
    version: VERSION,
    db,
    llm: {
      mode: mock ? 'mock' : 'live',
      mock,
      model,
    },
    oauthProviders: oauthProvidersConfigured(),
  }
}

/** Authenticated debug details (includes LLM base URL). */
export function getLlmDebugInfo(): { baseUrl: string; mode: 'mock' | 'live'; mock: boolean } {
  const mock = isMockLlmEnabled()
  return {
    baseUrl: config.LLM_BASE_URL,
    mode: mock ? 'mock' : 'live',
    mock,
  }
}
