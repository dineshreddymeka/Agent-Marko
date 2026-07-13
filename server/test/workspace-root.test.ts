import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { normalizeWorkspaceRootInput } from '../src/workspace/root'
import { resolveWorkspaceRoot } from '../src/paths'

describe('workspace root settings', () => {
  test('normalizeWorkspaceRootInput resolves relative paths from repo root', () => {
    const resolved = normalizeWorkspaceRootInput('./my-workspace')
    expect(resolved.replace(/\\/g, '/')).toMatch(/my-workspace$/)
  })

  test('normalizeWorkspaceRootInput keeps absolute paths', () => {
    const abs = 'D:/projects/jarvis-ws'
    expect(normalizeWorkspaceRootInput(abs)).toBe(abs)
  })

  test('fleet default is HERMES_DATA_DIR/workspace via loadConfig', async () => {
    const prevData = process.env.HERMES_DATA_DIR
    const prevWs = process.env.WORKSPACE_ROOT
    process.env.HERMES_DATA_DIR = 'D:/deploy/hermes-data'
    delete process.env.WORKSPACE_ROOT
    const { loadConfig } = await import('../src/config')
    expect(loadConfig().WORKSPACE_ROOT).toBe(join('D:/deploy/hermes-data', 'workspace'))
    process.env.HERMES_DATA_DIR = prevData
    if (prevWs === undefined) delete process.env.WORKSPACE_ROOT
    else process.env.WORKSPACE_ROOT = prevWs
  })

  test('empty input falls back to env default', async () => {
    const { envWorkspaceRoot } = await import('../src/workspace/root')
    expect(normalizeWorkspaceRootInput('')).toBe(envWorkspaceRoot)
    expect(normalizeWorkspaceRootInput('   ')).toBe(envWorkspaceRoot)
    expect(resolveWorkspaceRoot('', 'D:/data')).toBe(join('D:/data', 'workspace'))
  })
})
