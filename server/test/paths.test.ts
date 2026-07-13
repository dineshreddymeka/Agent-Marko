import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import {
  defaultHermesDataDir,
  resolveBackupDir,
  resolveCoworkWorkspace,
  resolveHermesDataDir,
  resolveWorkspaceRoot,
} from '../src/paths'

describe('fleet path resolution', () => {
  test('derive workspace and cowork dirs from HERMES_DATA_DIR', () => {
    const dataDir = 'D:/fleet/hermes-data'
    expect(resolveWorkspaceRoot('', dataDir)).toBe(join(dataDir, 'workspace'))
    expect(resolveCoworkWorkspace('', dataDir)).toBe(join(dataDir, 'cowork-workspace'))
    expect(resolveBackupDir('', dataDir)).toBe(join(dataDir, 'backups'))
  })

  test('explicit WORKSPACE_ROOT wins over data dir default', () => {
    const dataDir = 'D:/fleet/hermes-data'
    expect(resolveWorkspaceRoot('E:/custom/ws', dataDir)).toBe('E:/custom/ws')
  })

  test('empty HERMES_DATA_DIR uses platform default', () => {
    const resolved = resolveHermesDataDir('')
    expect(resolved.length).toBeGreaterThan(0)
    expect(defaultHermesDataDir()).toBe(resolved)
  })
})
