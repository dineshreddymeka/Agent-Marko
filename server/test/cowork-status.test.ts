import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { validateStatus } from '../src/cowork/status'

const temps: string[] = []

afterEach(async () => {
  for (const dir of temps.splice(0)) {
    await rm(dir, { recursive: true, force: true })
  }
})

async function makeWorkspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'cowork-status-'))
  temps.push(root)
  return root
}

async function writeStatus(
  workspaceRoot: string,
  taskId: string,
  body: unknown,
  files?: Record<string, string | Buffer>,
): Promise<void> {
  const outDir = join(workspaceRoot, 'outbox', taskId)
  await mkdir(outDir, { recursive: true })
  await writeFile(join(outDir, 'status.json'), JSON.stringify(body), 'utf8')
  if (files) {
    for (const [name, content] of Object.entries(files)) {
      await writeFile(join(outDir, name), content)
    }
  }
}

describe('validateStatus', () => {
  test('fails when status.json is missing', async () => {
    const root = await makeWorkspace()
    const result = await validateStatus(root, 't-20260711-001')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('missing')
  })

  test('fails on invalid JSON', async () => {
    const root = await makeWorkspace()
    const outDir = join(root, 'outbox', 't-20260711-001')
    await mkdir(outDir, { recursive: true })
    await writeFile(join(outDir, 'status.json'), '{not-json', 'utf8')
    const result = await validateStatus(root, 't-20260711-001')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('valid JSON')
  })

  test('fails when ok is false', async () => {
    const root = await makeWorkspace()
    await writeStatus(
      root,
      't-20260711-001',
      {
        taskId: 't-20260711-001',
        ok: false,
        files: [],
        error: 'could not generate deck',
      },
    )
    const result = await validateStatus(root, 't-20260711-001')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('could not generate deck')
  })

  test('fails on taskId mismatch', async () => {
    const root = await makeWorkspace()
    await writeStatus(root, 't-20260711-001', {
      taskId: 't-other',
      ok: true,
      files: [],
    })
    const result = await validateStatus(root, 't-20260711-001')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('mismatch')
  })

  test('fails when files[] entry is missing on disk', async () => {
    const root = await makeWorkspace()
    await writeStatus(root, 't-20260711-001', {
      taskId: 't-20260711-001',
      ok: true,
      files: ['summary.pptx'],
    })
    const result = await validateStatus(root, 't-20260711-001')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('missing on disk')
  })

  test('fails when files[] entry is empty', async () => {
    const root = await makeWorkspace()
    await writeStatus(
      root,
      't-20260711-001',
      { taskId: 't-20260711-001', ok: true, files: ['summary.pptx'] },
      { 'summary.pptx': '' },
    )
    const result = await validateStatus(root, 't-20260711-001')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('empty')
  })

  test('rejects path traversal in files[]', async () => {
    const root = await makeWorkspace()
    await writeStatus(root, 't-20260711-001', {
      taskId: 't-20260711-001',
      ok: true,
      files: ['../secrets.txt'],
    })
    const result = await validateStatus(root, 't-20260711-001')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('unsafe')
  })

  test('succeeds when ok and files exist non-empty', async () => {
    const root = await makeWorkspace()
    await writeStatus(
      root,
      't-20260711-001',
      {
        taskId: 't-20260711-001',
        ok: true,
        files: ['summary.pptx'],
        summary: 'Made a deck',
      },
      { 'summary.pptx': 'PK fake pptx bytes' },
    )
    const result = await validateStatus(root, 't-20260711-001')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.status.summary).toBe('Made a deck')
      expect(result.resolvedFiles.length).toBe(1)
    }
  })
})
