import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { isPathInsideRoot, resolveAllowedSourcePath } from '../src/cowork/task'
import { config } from '../src/config'

describe('cowork path jail', () => {
  test('isPathInsideRoot rejects parent traversal', () => {
    const root = resolve('/tmp/workspace-root')
    expect(isPathInsideRoot(root, join(root, 'inbox', 'a.txt'))).toBe(true)
    expect(isPathInsideRoot(root, join(root, '..', 'etc', 'passwd'))).toBe(false)
  })

  test('resolveAllowedSourcePath allows WORKSPACE_ROOT and rejects outside', async () => {
    const hermesRoot = resolve(process.cwd(), config.WORKSPACE_ROOT)
    await mkdir(hermesRoot, { recursive: true })
    const safe = join(hermesRoot, `jail-safe-${Date.now()}.txt`)
    await writeFile(safe, 'ok', 'utf8')
    expect(resolveAllowedSourcePath(safe)).toBe(resolve(safe))

    const outside = await mkdtemp(join(tmpdir(), 'cowork-jail-'))
    const evil = join(outside, 'secret.txt')
    await writeFile(evil, 'nope', 'utf8')
    expect(() => resolveAllowedSourcePath(evil)).toThrow(/escapes allowed workspace/)
  })
})
