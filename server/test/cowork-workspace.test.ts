import { afterEach, describe, expect, test } from 'bun:test'
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { packageTask } from '../src/cowork/task'
import { ensureDirs, WORKSPACE_SUBDIRS } from '../src/cowork/workspace'

const temps: string[] = []

afterEach(async () => {
  for (const dir of temps.splice(0)) {
    await rm(dir, { recursive: true, force: true })
  }
})

async function makeTempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'cowork-ws-'))
  temps.push(root)
  return root
}

describe('ensureDirs', () => {
  test('creates inbox/outbox/artifacts/logs/skills/state', async () => {
    const root = await makeTempRoot()
    await ensureDirs(root)

    for (const sub of WORKSPACE_SUBDIRS) {
      await access(join(root, sub))
    }
  })

  test('seeds jarvis-bridge SKILL.md under skills/', async () => {
    const root = await makeTempRoot()
    await ensureDirs(root)

    const skill = await readFile(join(root, 'skills', 'jarvis-bridge', 'SKILL.md'), 'utf8')
    expect(skill).toContain('name: jarvis-bridge')
    expect(skill).toContain('status.json')
    expect(skill).toContain('outbox/<taskId>/')
  })

  test('is idempotent and does not overwrite existing skill', async () => {
    const root = await makeTempRoot()
    await ensureDirs(root)
    const skillPath = join(root, 'skills', 'jarvis-bridge', 'SKILL.md')
    await writeFile(skillPath, 'custom skill content', 'utf8')

    await ensureDirs(root)
    expect(await readFile(skillPath, 'utf8')).toBe('custom skill content')
  })
})

describe('packageTask', () => {
  test('writes brief.md and returns prompt with relative paths', async () => {
    const root = await makeTempRoot()
    const packaged = await packageTask(root, 'Create a 3-slide deck as deck.pptx', undefined, {
      taskId: 't-20260711-099',
    })

    expect(packaged.taskId).toBe('t-20260711-099')
    expect(packaged.briefPath).toBe('inbox/t-20260711-099/brief.md')
    expect(packaged.prompt).toContain('inbox/t-20260711-099/brief.md')
    expect(packaged.prompt).not.toMatch(/[A-Za-z]:\\/)

    const brief = await readFile(join(root, 'inbox', 't-20260711-099', 'brief.md'), 'utf8')
    expect(brief).toContain('Create a 3-slide deck as deck.pptx')
    expect(brief).toContain('outbox/t-20260711-099/')
  })

  test('copies optional input files into inbox/<taskId>/', async () => {
    const root = await makeTempRoot()
    const src = join(root, 'source-content.md')
    await writeFile(src, '# Content\nHello', 'utf8')

    const packaged = await packageTask(
      root,
      'Use content.md',
      [{ sourcePath: src, name: 'content.md' }],
      { taskId: 't-20260711-100' },
    )

    expect(packaged.inputFiles).toEqual(['inbox/t-20260711-100/content.md'])
    const copied = await readFile(
      join(root, 'inbox', 't-20260711-100', 'content.md'),
      'utf8',
    )
    expect(copied).toContain('Hello')
  })
})
