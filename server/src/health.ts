import { pingDatabase } from './db/client'

export const VERSION = '0.1.0'

export interface HealthResponse {
  ok: boolean
  version: string
  db: boolean
}

export async function getHealthResponse(): Promise<HealthResponse> {
  const db = await pingDatabase()
  return { ok: true, version: VERSION, db }
}
