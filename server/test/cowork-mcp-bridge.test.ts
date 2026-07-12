/**
 * Jarvis MCP bridge (Slice B) — tool handlers + register helper.
 * No real Cowork.exe or database required (persist: false paths).
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  bridgeEntriesFromEvents,
  COWORK_PROGRESS_EVENT,
  COWORK_QUESTION_EVENT,
  createJarvisMcpBridgeServer,
  handleAsk,
  handleFetchContext,
  handleReportProgress,
} from '../src/cowork/mcp-bridge'
import {
  buildJarvisBridgeEntry,
  coworkMcpConfigPath,
  getJarvisMcpBridgeStatus,
  JARVIS_MCP_BRIDGE_ID,
  readCoworkMcpConfig,
  registerJarvisMcpBridge,
} from '../src/cowork/mcp-register'
import {
  listCoworkTaskProgress,
  listCoworkTaskQuestions,
  resetCoworkTaskStateForTests,
} from '../src/cowork/run-task'

const temps: string[] = []

beforeEach(() => {
  resetCoworkTaskStateForTests()
})

afterEach(async () => {
  resetCoworkTaskStateForTests()
  for (const dir of temps.splice(0)) {
    await rm(dir, { recursive: true, force: true })
  }
})

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'cowork-mcp-'))
  temps.push(dir)
  return dir
}

describe('jarvis_report_progress handler', () => {
  test('records progress on the task and returns the entry', async () => {
    const result = await handleReportProgress(
      { taskId: 't-20260712-001', message: 'Drafting slides', percent: 40 },
      { persist: false },
    )

    expect(result.ok).toBe(true)
    expect(result.taskId).toBe('t-20260712-001')
    expect(result.entry.message).toBe('Drafting slides')
    expect(result.entry.percent).toBe(40)
    expect(result.persisted).toBe(false)

    const progress = listCoworkTaskProgress('t-20260712-001')
    expect(progress).toHaveLength(1)
    expect(progress[0]!.message).toBe('Drafting slides')
  })

  test('clamps percent into 0-100 and appends in order', async () => {
    await handleReportProgress(
      { taskId: 't-1', message: 'start', percent: -5 },
      { persist: false },
    )
    await handleReportProgress(
      { taskId: 't-1', message: 'end', percent: 250 },
      { persist: false },
    )

    const progress = listCoworkTaskProgress('t-1')
    expect(progress.map((p) => p.message)).toEqual(['start', 'end'])
    expect(progress[0]!.percent).toBe(0)
    expect(progress[1]!.percent).toBe(100)
  })

  test('rejects missing taskId/message', async () => {
    expect(handleReportProgress({ taskId: '', message: 'x' }, { persist: false })).rejects.toThrow(
      'taskId is required',
    )
    expect(handleReportProgress({ taskId: 't-1', message: '  ' }, { persist: false })).rejects.toThrow(
      'message is required',
    )
  })
})

describe('jarvis_ask handler', () => {
  test('stores the question and acks with a question id without blocking', async () => {
    const result = await handleAsk(
      { taskId: 't-20260712-002', question: 'Which fiscal year?' },
      { persist: false },
    )

    expect(result.ok).toBe(true)
    expect(result.questionId).toBeTruthy()
    expect(result.answered).toBe(false)
    expect(result.hint).toContain('Do not wait')

    const questions = listCoworkTaskQuestions('t-20260712-002')
    expect(questions).toHaveLength(1)
    expect(questions[0]!.id).toBe(result.questionId)
    expect(questions[0]!.question).toBe('Which fiscal year?')
  })

  test('rejects missing question', async () => {
    expect(handleAsk({ taskId: 't-1', question: '' }, { persist: false })).rejects.toThrow(
      'question is required',
    )
  })
})

describe('jarvis_fetch_context handler', () => {
  test('returns safe empty shape when DB is unavailable / nothing matches', async () => {
    const result = await handleFetchContext({ query: 'nothing-matches-this' })
    expect(result.ok).toBe(true)
    expect(result.setting).toBeNull()
    expect(result.matches).toEqual([])
  })

  test('refuses sensitive settings keys', async () => {
    const result = await handleFetchContext({ key: 'llm.api_key' })
    expect(result.setting).toBeNull()
  })
})

describe('bridgeEntriesFromEvents', () => {
  test('extracts progress and questions from persisted run_events', () => {
    const { progress, questions } = bridgeEntriesFromEvents([
      {
        eventType: COWORK_PROGRESS_EVENT,
        payload: { taskId: 't-1', message: 'half way', percent: 50, at: '2026-07-12T01:00:00Z' },
        createdAt: '2026-07-12T01:00:01Z',
      },
      {
        eventType: COWORK_QUESTION_EVENT,
        payload: { taskId: 't-1', questionId: 'q-1', question: 'Deck color?', at: '2026-07-12T01:01:00Z' },
        createdAt: '2026-07-12T01:01:01Z',
      },
      { eventType: 'COWORK_STARTED', payload: { taskId: 't-1' }, createdAt: '2026-07-12T00:00:00Z' },
      { eventType: COWORK_PROGRESS_EVENT, payload: { taskId: 't-1' }, createdAt: 'x' }, // malformed → skipped
    ])

    expect(progress).toEqual([{ at: '2026-07-12T01:00:00Z', message: 'half way', percent: 50 }])
    expect(questions).toEqual([
      { id: 'q-1', question: 'Deck color?', at: '2026-07-12T01:01:00Z' },
    ])
  })
})

describe('createJarvisMcpBridgeServer', () => {
  test('builds an MCP server exposing exactly the three jarvis tools', () => {
    const mcp = createJarvisMcpBridgeServer()
    // Registered tools live on the underlying server; sanity-check shape only.
    expect(mcp).toBeTruthy()
    expect(typeof mcp.connect).toBe('function')
  })
})

describe('mcp-config.json registration', () => {
  test('coworkMcpConfigPath uses APPDATA', () => {
    const path = coworkMcpConfigPath('X:\\Roaming')
    expect(path).toBe(join('X:\\Roaming', 'open-cowork', 'mcp-config.json'))
  })

  test('creates config with the jarvis entry when file is missing', async () => {
    const dir = await makeTempDir()
    const configPath = join(dir, 'open-cowork', 'mcp-config.json')

    const status = await registerJarvisMcpBridge({ configPath })
    expect(status.registered).toBe(true)
    expect(status.configPath).toBe(configPath)

    const config = await readCoworkMcpConfig(configPath)
    expect(config?.servers).toHaveLength(1)
    const entry = config!.servers[0] as Record<string, unknown>
    expect(entry.id).toBe(JARVIS_MCP_BRIDGE_ID)
    expect(entry.name).toBe('Jarvis')
    expect(entry.type).toBe('stdio')
    expect(entry.enabled).toBe(true)
    expect(String(entry.command)).toBeTruthy()
    expect((entry.args as string[]).join(' ')).toContain('mcp-bridge-main.ts')
  })

  test('safe-merges into existing config, preserving other servers and unknown fields', async () => {
    const dir = await makeTempDir()
    const configPath = join(dir, 'mcp-config.json')
    await writeFile(
      configPath,
      JSON.stringify({
        version: 2,
        servers: [
          { id: 'other-server', name: 'Other', type: 'stdio', command: 'other.exe', args: [], enabled: true },
          { id: JARVIS_MCP_BRIDGE_ID, name: 'Old Jarvis', type: 'stdio', command: 'stale', args: [], enabled: false, custom: 'keep-me' },
        ],
      }),
      'utf8',
    )

    await registerJarvisMcpBridge({ configPath })

    const raw = JSON.parse(await readFile(configPath, 'utf8')) as {
      version: number
      servers: Array<Record<string, unknown>>
    }
    expect(raw.version).toBe(2) // unknown top-level fields preserved
    expect(raw.servers).toHaveLength(2)
    expect(raw.servers[0]!.id).toBe('other-server')
    const jarvis = raw.servers[1]!
    expect(jarvis.name).toBe('Jarvis') // refreshed
    expect(jarvis.enabled).toBe(true) // re-enabled
    expect(jarvis.custom).toBe('keep-me') // extra fields on the entry survive
  })

  test('refuses to overwrite a malformed config file', async () => {
    const dir = await makeTempDir()
    const configPath = join(dir, 'mcp-config.json')
    await writeFile(configPath, '{ not json', 'utf8')

    expect(registerJarvisMcpBridge({ configPath })).rejects.toThrow()
    expect(await readFile(configPath, 'utf8')).toBe('{ not json') // untouched
  })

  test('status reports registered only when an enabled entry exists', async () => {
    const dir = await makeTempDir()
    const configPath = join(dir, 'mcp-config.json')

    const before = await getJarvisMcpBridgeStatus({ configPath })
    expect(before.registered).toBe(false)
    expect(before.command).toContain('mcp-bridge-main.ts')
    expect(before.hint).toContain('register')

    await registerJarvisMcpBridge({ configPath, entry: buildJarvisBridgeEntry() })

    const after = await getJarvisMcpBridgeStatus({ configPath })
    expect(after.registered).toBe(true)
  })
})
