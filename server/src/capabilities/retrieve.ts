/**
 * Tool retrieval for a turn — semantic when embeddings work, else lexical.
 * Always includes core tools so the LLM can decide document/Cowork/A2UI/MCP.
 */
import type { LlmTool } from '../agent/llm'
import { config } from '../config'
import { logger } from '../log'
import {
  getCachedDescriptionVector,
  getCapabilityManifest,
  needsVectorRefresh,
  setCachedDescriptionVector,
  setRetrievalMode,
} from './hub'
import type { CapabilityTool, ToolsForTurn } from './types'

export const CORE_TOOL_NAMES = [
  'read_file',
  'write_file',
  'list_dir',
  'document_form_show',
  'delegate_to_cowork',
  'a2ui_render',
  'form_request_show',
  'memory_search',
  'memory_save',
  'web_search',
  'index_search',
  'skill_search',
] as const

const DEFAULT_TOP_K = 16

function cosine(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return -1
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!
    const y = b[i]!
    dot += x * y
    na += x * x
    nb += y * y
  }
  if (na === 0 || nb === 0) return -1
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

function lexicalScore(query: string, tool: CapabilityTool): number {
  const q = query.toLowerCase()
  const hay = `${tool.name} ${tool.server ?? ''} ${tool.description}`.toLowerCase()
  if (!q.trim()) return tool.trusted ? 0.1 : 0
  let score = 0
  for (const token of q.split(/[^a-z0-9_]+/i).filter((t) => t.length > 2)) {
    if (hay.includes(token)) score += 1
    if (tool.name.toLowerCase().includes(token)) score += 2
  }
  if (tool.trusted) score += 0.25
  if (CORE_TOOL_NAMES.includes(tool.name as (typeof CORE_TOOL_NAMES)[number])) score += 0.5
  return score
}

function strengthenDescriptions(tools: LlmTool[]): LlmTool[] {
  return tools.map((t) => {
    const name = t.function.name
    if (name === 'document_form_show') {
      return {
        ...t,
        function: {
          ...t.function,
          description:
            'Show the interactive document/PPT form when topic, audience, length, or deliverable type is missing. Prefer this over asking clarifying questions in plain text. Use for multi-turn follow-ups like "in a pdf?" after a topic was discussed.',
        },
      }
    }
    if (name === 'delegate_to_cowork') {
      return {
        ...t,
        function: {
          ...t.function,
          description:
            'Delegate PDF/Word/PowerPoint/spreadsheet generation to Open Cowork when the deliverable is clear enough. If audience/length/style are missing, call document_form_show first.',
        },
      }
    }
    if (name === 'write_file') {
      return {
        ...t,
        function: {
          ...t.function,
          description:
            'Write a workspace markdown draft (e.g. drafts/<topic>-draft.md) when the user wants a saved draft and the topic is known. Prefer this for "save in the workspace" requests.',
        },
      }
    }
    if (name === 'a2ui_render') {
      return {
        ...t,
        function: {
          ...t.function,
          description:
            'Render an interactive A2UI surface in chat for structured UI beyond plain markdown.',
        },
      }
    }
    return t
  })
}

function toLlmTool(tool: CapabilityTool): LlmTool {
  // Prefer live registry schema when present.
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: { type: 'object', properties: {} },
    },
  }
}

async function hydrateFromRegistry(selected: CapabilityTool[]): Promise<LlmTool[]> {
  const { toLlmTools } = await import('../agent/tools/registry')
  const all = toLlmTools()
  const byName = new Map(all.map((t) => [t.function.name, t]))
  return selected.map((t) => byName.get(t.name) ?? toLlmTool(t))
}

async function tryEmbed(text: string): Promise<number[] | null> {
  try {
    const { embedText } = await import('../vector/embeddings')
    const vec = await Promise.race([
      embedText(text),
      Bun.sleep(2500).then(() => null),
    ])
    return vec && vec.length ? vec : null
  } catch (err) {
    logger.debug('Capability retrieval embeddings unavailable', { error: String(err) })
    return null
  }
}

async function ensureToolVectors(tools: CapabilityTool[]): Promise<boolean> {
  const missing = tools.filter((t) => needsVectorRefresh(t.name, t.description))
  if (missing.length === 0) {
    return tools.every((t) => getCachedDescriptionVector(t.name) != null)
  }
  try {
    const { embedBatch } = await import('../vector/embeddings')
    const vectors = await Promise.race([
      embedBatch(missing.map((t) => `${t.name}: ${t.description}`)),
      Bun.sleep(4000).then(() => {
        throw new Error('embedBatch timeout')
      }),
    ])
    missing.forEach((t, i) => {
      setCachedDescriptionVector(t.name, t.description, vectors[i] ?? null)
    })
    return tools.every((t) => getCachedDescriptionVector(t.name) != null)
  } catch {
    for (const t of missing) {
      // Keep hash so we do not thrash; vector stays null → lexical path.
      setCachedDescriptionVector(t.name, t.description, null)
    }
    return false
  }
}

export async function getToolsForTurn(opts: {
  query: string
  toolsEnabled: boolean
  topK?: number
}): Promise<ToolsForTurn> {
  if (!opts.toolsEnabled) {
    setRetrievalMode('legacy')
    return { tools: [], retrievalMode: 'legacy', offered: [] }
  }

  if (config.HERMES_ROUTING === 'legacy') {
    const { selectLlmToolsLegacy } = await import('./legacy-select')
    const tools = selectLlmToolsLegacy(opts.query)
    setRetrievalMode('legacy')
    return {
      tools,
      retrievalMode: 'legacy',
      offered: tools.map((t) => t.function.name),
    }
  }

  const manifest = await getCapabilityManifest()
  const topK = opts.topK ?? DEFAULT_TOP_K
  const query = opts.query.slice(0, 2000)

  let mode: 'semantic' | 'lexical' = 'lexical'
  let ranked: CapabilityTool[] = []

  const hasVectors = await ensureToolVectors(manifest.tools)
  const queryVec = hasVectors ? await tryEmbed(query) : null

  if (queryVec) {
    mode = 'semantic'
    ranked = [...manifest.tools]
      .map((tool) => {
        const vec = getCachedDescriptionVector(tool.name)
        const score = vec ? cosine(queryVec, vec) : -1
        return { tool, score }
      })
      .sort((a, b) => b.score - a.score)
      .map((x) => x.tool)
  } else {
    mode = 'lexical'
    ranked = [...manifest.tools]
      .map((tool) => ({ tool, score: lexicalScore(query, tool) }))
      .sort((a, b) => b.score - a.score)
      .map((x) => x.tool)
  }

  const selected = new Map<string, CapabilityTool>()
  for (const name of CORE_TOOL_NAMES) {
    const hit = manifest.tools.find((t) => t.name === name)
    if (hit) selected.set(name, hit)
  }
  for (const tool of ranked) {
    if (selected.size >= topK) break
    selected.set(tool.name, tool)
  }

  // Always keep at least a few MCP tools when connected and query mentions integrations.
  if (/mcp|plugin|connect|integration|browser|chrome/i.test(query)) {
    for (const tool of manifest.tools.filter((t) => t.source === 'mcp')) {
      if (selected.size >= topK + 4) break
      selected.set(tool.name, tool)
    }
  }

  const tools = strengthenDescriptions(await hydrateFromRegistry([...selected.values()]))
  setRetrievalMode(mode)
  return {
    tools,
    retrievalMode: mode,
    offered: tools.map((t) => t.function.name),
  }
}
