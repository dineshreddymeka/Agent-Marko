/**
 * Real-world document + Cowork + Chrome/MCP scenarios.
 * Intent → draft → chrome research → cowork package/run → tool registration.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  buildDocumentDraftMarkdown,
  documentDraftPath,
  extractDocumentTopic,
  inferDeliverableType,
  looksLikeDocumentIntent,
  prefersCoworkDocument,
  shouldAutoCreateDocumentDraft,
  shouldAutoShowDocumentForm,
} from '../src/agent/document-intent'
import { buildDocumentFormFromUserText } from '../src/agent/tools/a2ui'
import { getTool, toLlmTools, type ToolContext } from '../src/agent/tools/registry'
import '../src/agent/tools/chrome'
import '../src/agent/tools/files'
import '../src/agent/tools/delegate_to_cowork'
import { resetChromeSession } from '../src/agent/tools/chrome'
import { packageTask, generateTaskId } from '../src/cowork/task'
import { buildTaskPrompt } from '../src/cowork/prompt'
import { createMockCoworkSpawn } from './helpers/mock-cowork-child'
import { resetCoworkTaskStateForTests, runCoworkTask } from '../src/cowork/run-task'
import { CoworkClient } from '../src/cowork/client'

function toolCtx(sessionId = 's1', runId = 'r1'): ToolContext {
  return {
    sessionId,
    runId,
    signal: new AbortController().signal,
    emit: async () => undefined,
  }
}

describe('real-world document + cowork + chrome scenarios', () => {
  let workspace: string

  beforeEach(async () => {
    process.env.HERMES_CHROME_MOCK = '1'
    workspace = await mkdtemp(join(tmpdir(), 'hermes-doc-scen-'))
    resetChromeSession()
    resetCoworkTaskStateForTests()
  })

  afterEach(async () => {
    resetChromeSession()
    resetCoworkTaskStateForTests()
    await rm(workspace, { recursive: true, force: true }).catch(() => undefined)
  })

  test('scenario: vague PPT ask shows document form (not auto draft)', () => {
    const text = 'I need a ppt on JNJ'
    expect(looksLikeDocumentIntent(text)).toBe(true)
    expect(prefersCoworkDocument(text)).toBe(true)
    expect(shouldAutoShowDocumentForm(text)).toBe(true)
    expect(shouldAutoCreateDocumentDraft(text)).toBe(false)
    expect(inferDeliverableType(text)).toBe('presentation')
    const form = buildDocumentFormFromUserText(text)
    expect(form.component.type).toBe('hermes:DocumentRequestForm')
    expect(String(form.component.props.topic ?? '')).toMatch(/jnj/i)
  })

  test('scenario: clear markdown draft writes drafts/<topic>-draft.md', async () => {
    const text = 'Write a draft document about Q2 revenue results'
    expect(shouldAutoCreateDocumentDraft(text)).toBe(true)
    const topic = extractDocumentTopic(text)
    expect(topic).toBeTruthy()
    const rel = documentDraftPath(topic!)
    expect(rel.startsWith('drafts/')).toBe(true)
    expect(rel.endsWith('-draft.md')).toBe(true)

    const body = buildDocumentDraftMarkdown(topic!, text)
    const abs = join(workspace, rel)
    await mkdir(join(workspace, 'drafts'), { recursive: true })
    await writeFile(abs, body, 'utf8')
    const saved = await readFile(abs, 'utf8')
    expect(saved).toContain(topic!)
    expect(saved.length).toBeGreaterThan(40)
  })

  test('scenario: chrome research → draft markdown from page excerpt', async () => {
    const open = getTool('chrome_open')
    const content = getTool('chrome_get_content')
    const shot = getTool('chrome_screenshot')
    expect(open && content && shot).toBeTruthy()

    const ctx = toolCtx()
    const opened = (await open!.execute({ url: 'https://example.com/research/q2-outlook' }, ctx)) as {
      ok: boolean
      title: string
      url: string
    }
    expect(opened.ok).toBe(true)
    expect(opened.url).toContain('example.com')

    const page = (await content!.execute({ maxChars: 800 }, ctx)) as {
      ok: boolean
      text: string
      title: string
    }
    expect(page.ok).toBe(true)
    expect(page.text.toLowerCase()).toContain('mock')

    const capture = (await shot!.execute({ name: 'q2-outlook' }, ctx)) as {
      ok: boolean
      relativePath: string
    }
    expect(capture.ok).toBe(true)
    expect(capture.relativePath).toContain('chrome-captures/')

    const draftRel = 'drafts/q2-outlook-from-chrome-draft.md'
    await mkdir(join(workspace, 'drafts'), { recursive: true })
    const draftBody = [
      '# Q2 Outlook (from Chrome research)',
      '',
      `Source: ${opened.url}`,
      `Title: ${page.title}`,
      '',
      page.text,
      '',
      `Screenshot: ${capture.relativePath}`,
    ].join('\n')
    await writeFile(join(workspace, draftRel), draftBody, 'utf8')
    const saved = await readFile(join(workspace, draftRel), 'utf8')
    expect(saved).toContain('Chrome research')
    expect(saved).toContain(page.text.slice(0, 40))
  })

  test('scenario: fully-specified PDF board brief packages Cowork inbox', async () => {
    const goal =
      'Create a PDF board brief on enterprise risk for the audit committee, 5 pages, formal tone'
    expect(prefersCoworkDocument(goal)).toBe(true)
    expect(inferDeliverableType(goal)).toBe('pdf')

    const coworkRoot = await mkdtemp(join(tmpdir(), 'hermes-cowork-ws-'))
    const taskId = generateTaskId()
    const packaged = await packageTask(coworkRoot, goal, undefined, { taskId })
    expect(packaged.briefPath).toBe(`inbox/${taskId}/brief.md`)
    const brief = await readFile(join(coworkRoot, packaged.briefPath), 'utf8')
    expect(brief.toLowerCase()).toContain('risk')
    const prompt = buildTaskPrompt(taskId, goal)
    expect(prompt).toContain(taskId)
    expect(prompt).toContain(`inbox/${taskId}/brief.md`)

    await rm(coworkRoot, { recursive: true, force: true })
  })

  test(
    'scenario: Cowork run with mock child writes outbox status and completes',
    async () => {
      const coworkRoot = await mkdtemp(join(tmpdir(), 'hermes-cowork-run-'))
      await mkdir(join(coworkRoot, 'outbox'), { recursive: true })
      const taskId = 't-20260712-300'
      await mkdir(join(coworkRoot, 'outbox', taskId), { recursive: true })

      const mock = createMockCoworkSpawn({
        taskDelayMs: 5,
        writeStatusForTaskId: taskId,
        textDeltas: ['Drafting PDF…', 'Validating outbox…'],
      })

      const result = await runCoworkTask({
        taskId,
        goal: 'Produce a PDF summary of Q2 results for leadership',
        deliverableType: 'pdf',
        workspace: coworkRoot,
        persist: false,
        autoApprove: true,
        timeoutMs: 5_000,
        createClient: (opts) =>
          new CoworkClient({
            ...opts,
            exe: 'mock-open-cowork',
            spawnFn: mock.spawnFn,
            readyTimeoutMs: 2_000,
          }),
      })

      expect(result.taskId).toBe(taskId)
      expect(result.ok).toBe(true)
      expect(result.status).toBe('done')
      expect(result.briefPath).toBe(`inbox/${taskId}/brief.md`)

      const statusPath = join(coworkRoot, 'outbox', taskId, 'status.json')
      const statusRaw = await readFile(statusPath, 'utf8')
      expect(statusRaw.length).toBeGreaterThan(2)

      await rm(coworkRoot, { recursive: true, force: true })
    },
    15_000,
  )

  test('scenario: edit existing draft then re-package for Cowork Word deliverable', async () => {
    const topic = 'vendor-risk'
    const coworkRoot = await mkdtemp(join(tmpdir(), 'hermes-cowork-word-'))
    // Draft must live under an allowed root (Hermes WORKSPACE_ROOT or Cowork workspace).
    await mkdir(join(coworkRoot, 'drafts'), { recursive: true })
    const abs = join(coworkRoot, 'drafts', 'vendor-risk-draft.md')
    await writeFile(abs, buildDocumentDraftMarkdown(topic, 'Write a draft about vendor-risk for legal'), 'utf8')
    const edited = (await readFile(abs, 'utf8')) + '\n\n## Update\nAdded vendor SLA notes.\n'
    await writeFile(abs, edited, 'utf8')
    expect(await readFile(abs, 'utf8')).toContain('vendor SLA')

    const taskId = generateTaskId()
    const packaged = await packageTask(
      coworkRoot,
      'Turn the vendor-risk draft into a Word brief for legal',
      [{ sourcePath: abs, name: 'vendor-risk-draft.md' }],
      { taskId },
    )
    expect(packaged.briefPath).toBe(`inbox/${taskId}/brief.md`)
    expect(packaged.inputFiles.some((f) => f.includes('vendor-risk'))).toBe(true)
    const brief = await readFile(join(coworkRoot, packaged.briefPath), 'utf8')
    expect(brief.toLowerCase()).toMatch(/vendor|word|legal/)

    await rm(coworkRoot, { recursive: true, force: true })
  })

  test('scenario: chrome + files + cowork tools are registered for the LLM tool list', () => {
    const names = new Set(toLlmTools().map((t) => t.function.name))
    for (const n of [
      'chrome_open',
      'chrome_navigate',
      'chrome_get_content',
      'chrome_screenshot',
      'write_file',
      'read_file',
      'delegate_to_cowork',
    ]) {
      expect(names.has(n)).toBe(true)
    }
  })
})
