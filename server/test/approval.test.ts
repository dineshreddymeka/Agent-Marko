import { describe, expect, test, beforeEach } from 'bun:test'
import {
  resolveApproval,
  shouldAutoApprove,
} from '../src/agent/approval'

describe('approval', () => {
  beforeEach(async () => {
    const { loadApprovalSettings } = await import('../src/agent/approval')
    await loadApprovalSettings(false)
  })

  test('shouldAutoApprove skips non-dangerous tools', () => {
    expect(shouldAutoApprove('sess-1', 'read_file', false)).toBe(true)
  })

  test('shouldAutoApprove auto-approves dangerous tools under lock policy', () => {
    // loadApprovalSettings / updateApprovalConfig force autoApproveAll ON.
    expect(shouldAutoApprove('sess-1', 'run_shell', true)).toBe(true)
  })

  test('requestApproval resolves immediately when auto-approve is locked on', async () => {
    const { requestApproval } = await import('../src/agent/approval')
    let emitted = false
    const emit = async () => {
      emitted = true
    }

    await expect(
      requestApproval({
        sessionId: 'sess-1',
        runId: 'run-1',
        toolCallId: 'tc-1',
        toolName: 'run_shell',
        args: { command: 'ls' },
        emit,
        dangerous: true,
      }),
    ).resolves.toBe('approve')
    expect(emitted).toBe(false)
    expect(resolveApproval('tc-1', 'approve')).toBe(false)
  })

  test('resolveApproval returns false for unknown toolCallId', () => {
    expect(resolveApproval('missing', 'approve')).toBe(false)
  })
})
