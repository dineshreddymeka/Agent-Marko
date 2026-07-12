import { describe, expect, test, beforeAll } from 'bun:test'

// Register native tools so the capability hub / retrieval can hydrate schemas.
import '../src/agent/tools/files'
import '../src/agent/tools/web'
import '../src/agent/tools/memory'
import '../src/agent/tools/skills'
import '../src/agent/tools/a2ui'
import '../src/agent/tools/delegate_to_cowork'
import '../src/agent/tools/index_search'

import {
  CORE_TOOL_NAMES,
  getToolsForTurn,
  refreshCapabilityManifest,
  setCachedDescriptionVector,
  threadQueryFromMessages,
} from '../src/capabilities'

describe('capabilities retrieval', () => {
  beforeAll(async () => {
    const manifest = await refreshCapabilityManifest('test')
    // Force lexical path: hashed descriptions with null vectors (no embed HTTP).
    for (const t of manifest.tools) {
      setCachedDescriptionVector(t.name, t.description, null)
    }
  })

  test('threadQueryFromMessages keeps last 3 user turns for follow-ups', () => {
    const query = threadQueryFromMessages([
      { role: 'user', content: 'Tell me about New Jersey' },
      { role: 'assistant', content: 'New Jersey is…' },
      { role: 'user', content: 'in a pdf?' },
      { role: 'user', content: 'make it short' },
    ])
    expect(query).toContain('New Jersey')
    expect(query).toContain('in a pdf?')
    expect(query).toContain('make it short')
  })

  test('core tools are always offered when tools enabled', async () => {
    const turn = await getToolsForTurn({
      query: 'hello',
      toolsEnabled: true,
      topK: 16,
    })
    expect(turn.offered.length).toBeGreaterThan(0)
    expect(turn.retrievalMode).toBe('lexical')
    for (const name of [
      'read_file',
      'write_file',
      'document_form_show',
      'delegate_to_cowork',
      'a2ui_render',
    ] as const) {
      expect(CORE_TOOL_NAMES.includes(name)).toBe(true)
      expect(turn.offered).toContain(name)
    }
  })

  test('golden prompts offer expected tools (lexical)', async () => {
    const cases: Array<{ query: string; expectAny: string[] }> = [
      { query: 'New Jersey\nin a pdf?', expectAny: ['document_form_show', 'delegate_to_cowork'] },
      {
        query: 'create a powerpoint about jnj',
        expectAny: ['document_form_show', 'delegate_to_cowork'],
      },
      { query: 'can you make me a form', expectAny: ['form_request_show'] },
      { query: 'delegate this to cowork', expectAny: ['delegate_to_cowork'] },
      { query: 'render an a2ui surface', expectAny: ['a2ui_render'] },
      { query: 'search my indexed files', expectAny: ['index_search'] },
    ]

    for (const c of cases) {
      const turn = await getToolsForTurn({ query: c.query, toolsEnabled: true, topK: 16 })
      const hit = c.expectAny.some((name) => turn.offered.includes(name))
      expect(hit).toBe(true)
    }
  })

  test('toolsEnabled=false returns empty set', async () => {
    const turn = await getToolsForTurn({ query: 'in a pdf?', toolsEnabled: false })
    expect(turn.tools).toEqual([])
    expect(turn.offered).toEqual([])
    expect(turn.retrievalMode).toBe('legacy')
  })
})
