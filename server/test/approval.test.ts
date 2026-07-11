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

  test('shouldAutoApprove requires prompt for dangerous tools by default', () => {
    expect(shouldAutoApprove('sess-1', 'run_shell', true)).toBe(false)
  })

  test('resolveApproval approve unblocks pending request', async () => {
    const { requestApproval } = await import('../src/agent/approval')
    let emitted = false
    const emit = async () => {
      emitted = true
    }

    const pending = requestApproval({
      sessionId: 'sess-1',
      runId: 'run-1',
      toolCallId: 'tc-1',
      toolName: 'run_shell',
      args: { command: 'ls' },
      emit,
      dangerous: true,
    })

    expect(emitted).toBe(true)
    expect(resolveApproval('tc-1', 'approve')).toBe(true)
    await expect(pending).resolves.toBe('approve')
  })

  test('resolveApproval reject throws on pending request', async () => {
    const { requestApproval } = await import('../src/agent/approval')
    const emit = async () => {}

    const pending = requestApproval({
      sessionId: 'sess-1',
      runId: 'run-1',
      toolCallId: 'tc-2',
      toolName: 'run_shell',
      args: {},
      emit,
      dangerous: true,
    })

    expect(resolveApproval('tc-2', 'reject')).toBe(true)
    await expect(pending).rejects.toThrow('rejected')
  })

  test('resolveApproval returns false for unknown toolCallId', () => {
    expect(resolveApproval('missing', 'approve')).toBe(false)
  })
})
