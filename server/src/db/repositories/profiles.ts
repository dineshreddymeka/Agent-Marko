import { eq } from 'drizzle-orm'
import type { Profile } from '@hermes/shared'
import { getDb } from '../client'
import { profiles } from '../schema'

function toDto(row: typeof profiles.$inferSelect): Profile {
  return {
    id: row.id,
    name: row.name,
    systemPrompt: row.systemPrompt,
    model: row.model,
    temperature: row.temperature,
    provider: row.provider as Profile['provider'],
    providerConfig: (row.providerConfig as Record<string, unknown> | null) ?? null,
    settings: (row.settings as Record<string, unknown> | null) ?? null,
  }
}

export const profilesRepo = {
  async list(): Promise<Profile[]> {
    const db = getDb()
    const rows = await db.select().from(profiles)
    return rows.map(toDto)
  },

  async getById(id: string): Promise<Profile | null> {
    const db = getDb()
    const [row] = await db.select().from(profiles).where(eq(profiles.id, id)).limit(1)
    return row ? toDto(row) : null
  },

  async getDefault(): Promise<Profile | null> {
    const db = getDb()
    const [row] = await db.select().from(profiles).limit(1)
    return row ? toDto(row) : null
  },

  async create(input: {
    name: string
    systemPrompt?: string
    model?: string
    temperature?: number
    provider?: Profile['provider']
    providerConfig?: Record<string, unknown> | null
    settings?: Record<string, unknown> | null
  }): Promise<Profile> {
    const db = getDb()
    const [row] = await db
      .insert(profiles)
      .values({
        name: input.name,
        systemPrompt: input.systemPrompt ?? 'You are Open Jarvis, a helpful AI assistant.',
        model: input.model ?? 'gpt-4o-mini',
        temperature: input.temperature ?? 0.7,
        provider: input.provider ?? 'native',
        providerConfig: input.providerConfig ?? null,
        settings: input.settings ?? null,
      })
      .returning()
    if (!row) throw new Error('Failed to create profile')
    return toDto(row)
  },

  async update(
    id: string,
    patch: Partial<{
      name: string
      systemPrompt: string
      model: string
      temperature: number
      provider: Profile['provider']
      providerConfig: Record<string, unknown> | null
      settings: Record<string, unknown> | null
    }>,
  ): Promise<Profile | null> {
    const db = getDb()
    const [row] = await db
      .update(profiles)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(profiles.id, id))
      .returning()
    return row ? toDto(row) : null
  },

  async delete(id: string): Promise<boolean> {
    const db = getDb()
    const result = await db.delete(profiles).where(eq(profiles.id, id)).returning({ id: profiles.id })
    return result.length > 0
  },
}
