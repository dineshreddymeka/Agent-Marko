/**
 * In-memory Capability Hub — unified catalog for tools, MCP, skills, Cowork.
 */
import { createHash } from 'node:crypto'
import { listTools } from '../agent/tools/registry'
import { config } from '../config'
import { getConnectionStates, getPromptMetas, getToolMetas } from '../mcp/manager'
import { logger } from '../log'
import type {
  CapabilityManifest,
  CapabilityPlugin,
  CapabilityProvider,
  CapabilitySkill,
  CapabilitySlashCommand,
  CapabilityTool,
} from './types'

type VectorEntry = {
  hash: string
  vector: number[] | null
}

let manifest: CapabilityManifest | null = null
let building: Promise<CapabilityManifest> | null = null
const descriptionVectors = new Map<string, VectorEntry>()
let retrievalMode: CapabilityManifest['retrievalMode'] = 'lexical'

const MCP_DESC_MAX = 400
const MCP_TOOLS_PER_SERVER = 24
const MCP_TOOLS_GLOBAL = 80

function hashText(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 24)
}

function sanitizeDescription(text: string, max = MCP_DESC_MAX): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, max)
}

export function getCachedDescriptionVector(name: string): number[] | null {
  return descriptionVectors.get(name)?.vector ?? null
}

export function setCachedDescriptionVector(
  name: string,
  description: string,
  vector: number[] | null,
): void {
  descriptionVectors.set(name, { hash: hashText(description), vector })
}

export function descriptionHash(description: string): string {
  return hashText(description)
}

export function needsVectorRefresh(name: string, description: string): boolean {
  const existing = descriptionVectors.get(name)
  if (!existing) return true
  return existing.hash !== hashText(description)
}

async function loadSkills(): Promise<CapabilitySkill[]> {
  try {
    const { pingDatabase } = await import('../db/client')
    const reachable = await Promise.race([
      pingDatabase(),
      Bun.sleep(1500).then(() => false),
    ])
    if (!reachable) return []
    const { skillsRepo } = await import('../db/repositories/skills')
    const skills = await Promise.race([
      skillsRepo.list(200),
      Bun.sleep(2000).then(() => {
        throw new Error('skills list timeout')
      }),
    ])
    return skills.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description ?? '',
      triggers: s.triggers,
      source: s.source ?? 'user-folder',
    }))
  } catch {
    return []
  }
}

async function loadCoworkPlugins(): Promise<CapabilityPlugin[]> {
  try {
    const { getCoworkSetupInfo, getJarvisMcpBridgeStatus } = await import('../cowork')
    const info = getCoworkSetupInfo()
    const bridge = await getJarvisMcpBridgeStatus()

    const coworkStatus = !info.configured
      ? 'not_configured'
      : info.exeExists && info.headlessSupported !== false
        ? 'connected'
        : 'degraded'

    return [
      {
        id: 'cowork',
        kind: 'cowork',
        name: 'Open Cowork',
        status: coworkStatus,
        toolCount: 1,
        trusted: true,
      },
      {
        id: 'jarvis-mcp-bridge',
        kind: 'mcp',
        name: 'Jarvis MCP Bridge',
        status: bridge.readiness,
        toolCount: 3,
        trusted: true,
      },
    ]
  } catch {
    return [
      {
        id: 'cowork',
        kind: 'cowork',
        name: 'Open Cowork',
        status: 'unknown',
        toolCount: 1,
        trusted: true,
      },
      {
        id: 'jarvis-mcp-bridge',
        kind: 'mcp',
        name: 'Jarvis MCP Bridge',
        status: 'unknown',
        toolCount: 3,
        trusted: true,
      },
    ]
  }
}

function buildToolEntries(): CapabilityTool[] {
  const mcpMeta = new Map(getToolMetas().map((m) => [m.namespaced, m]))
  const perServer = new Map<string, number>()
  let mcpGlobal = 0
  const out: CapabilityTool[] = []

  for (const tool of listTools()) {
    const isMcp = tool.name.startsWith('mcp:') || Boolean(tool.mcpServerId)
    if (isMcp) {
      const serverKey = tool.mcpServerId ?? tool.name.split('/')[0] ?? 'mcp'
      const count = perServer.get(serverKey) ?? 0
      if (count >= MCP_TOOLS_PER_SERVER || mcpGlobal >= MCP_TOOLS_GLOBAL) continue
      perServer.set(serverKey, count + 1)
      mcpGlobal += 1
    }

    const meta = mcpMeta.get(tool.name)
    out.push({
      name: tool.name,
      source: isMcp ? 'mcp' : 'native',
      server: meta?.serverName,
      serverId: tool.mcpServerId,
      dangerous: tool.dangerous ?? (isMcp ? true : false),
      description: sanitizeDescription(tool.description, isMcp ? MCP_DESC_MAX : 800),
      trusted: !isMcp,
    })
  }
  return out
}

function buildMcpPlugins(): CapabilityPlugin[] {
  return getConnectionStates().map((s) => ({
    id: s.serverId,
    kind: 'mcp' as const,
    name: s.name,
    status: s.status,
    toolCount: s.tools?.length ?? 0,
    trusted: false,
  }))
}

function buildSlashCommands(): CapabilitySlashCommand[] {
  return getPromptMetas().map((p) => ({
    name: p.slash || `/mcp:${p.serverName}:${p.name}`,
    server: p.serverName,
    description: sanitizeDescription(p.description || `MCP prompt ${p.name}`),
  }))
}

async function loadProviders(): Promise<CapabilityProvider[]> {
  try {
    const { buildProviderCapabilityEntries } = await import('../agent/provider-capabilities')
    return await buildProviderCapabilityEntries()
  } catch {
    return []
  }
}

export async function buildCapabilityManifest(): Promise<CapabilityManifest> {
  const [skills, coworkPlugins, providers] = await Promise.all([
    loadSkills(),
    loadCoworkPlugins(),
    loadProviders(),
  ])
  const plugins = buildMcpPlugins()
  plugins.unshift(...coworkPlugins)

  const next: CapabilityManifest = {
    tools: buildToolEntries(),
    skills,
    plugins,
    slashCommands: buildSlashCommands(),
    providers,
    refreshedAt: new Date().toISOString(),
    retrievalMode: config.HERMES_ROUTING === 'legacy' ? 'legacy' : retrievalMode,
    routing: config.HERMES_ROUTING,
  }
  manifest = next
  return next
}

export async function refreshCapabilityManifest(reason = 'manual'): Promise<CapabilityManifest> {
  if (building) return building
  building = buildCapabilityManifest()
    .then((m) => {
      logger.debug('Capability manifest refreshed', {
        reason,
        tools: m.tools.length,
        skills: m.skills.length,
        plugins: m.plugins.length,
        providers: m.providers.length,
      })
      return m
    })
    .finally(() => {
      building = null
    })
  return building
}

export function invalidateCapabilityManifest(reason = 'invalidate'): void {
  manifest = null
  void refreshCapabilityManifest(reason).catch((err) => {
    logger.warn('Capability manifest refresh failed', { error: String(err), reason })
  })
}

export async function getCapabilityManifest(): Promise<CapabilityManifest> {
  if (manifest) return manifest
  return refreshCapabilityManifest('lazy')
}

export function getCapabilityManifestSync(): CapabilityManifest | null {
  return manifest
}

export function setRetrievalMode(mode: CapabilityManifest['retrievalMode']): void {
  retrievalMode = mode
  if (manifest) manifest = { ...manifest, retrievalMode: mode }
}

export function getDescriptionVectorCacheSize(): number {
  return descriptionVectors.size
}
