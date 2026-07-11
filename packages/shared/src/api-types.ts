/** REST API DTOs shared between app and server (Phase 2+) */

export interface Session {
  id: string
  title: string
  groupName: string | null
  profileId: string | null
  pinned: boolean
  archived: boolean
  createdAt: string
  updatedAt: string
}

export interface Message {
  id: string
  sessionId: string
  runId: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  toolName: string | null
  toolArgs: Record<string, unknown> | null
  toolResult: Record<string, unknown> | null
  thinking: string | null
  a2ui: Record<string, unknown> | null
  tokens: number
  createdAt: string
}

export interface Skill {
  id: string
  name: string
  description: string
  bodyMd: string
  source: 'builtin' | 'user-folder' | `git:${string}` | 'learned'
  path: string | null
  triggers: string[] | null
  usageCount: number
  successCount: number
  createdAt: string
  updatedAt: string
}

export interface MemoryEntry {
  id: string
  kind: 'semantic' | 'episodic' | 'preference'
  content: string
  sourceSession: string | null
  importance: number
  createdAt: string
  lastAccessed: string
}

export interface CronJob {
  id: string
  name: string
  schedule: string
  prompt: string
  profileId: string | null
  enabled: boolean
  lastRun: string | null
  nextRun: string | null
}

export interface Profile {
  id: string
  name: string
  systemPrompt: string
  model: string
  temperature: number
  provider: 'native' | 'agui-remote' | 'hermes-python'
  providerConfig: Record<string, unknown> | null
  settings: Record<string, unknown> | null
}
