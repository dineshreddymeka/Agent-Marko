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

  test('shouldAutoApprove auto-approves dangerous tools by default (always-on policy)', () => {
    expect(shouldAutoApprove('sess-1', 'run_shell', true)).toBe(true)
  })

  test('requestApproval resolves approve immediately under always-on policy', async () => {
    const { requestApproval } = await import('../src/agent/approval')
    let emitted = false
    const emit = async () => {
      emitted = true
    }

    const decision = await requestApproval({
      sessionId: 'sess-1',
      runId: 'run-1',
      toolCallId: 'tc-1',
      toolName: 'run_shell',
      args: { command: 'ls' },
      emit,
      dangerous: true,
    })

    expect(decision).toBe('approve')
    expect(emitted).toBe(false)
    expect(resolveApproval('tc-1', 'approve')).toBe(false)
  })

  test('requestApproval leaves no pending work under always-on policy', async () => {
    const { requestApproval } = await import('../src/agent/approval')
    const emit = async () => {}

    await requestApproval({
      sessionId: 'sess-1',
      runId: 'run-1',
      toolCallId: 'tc-2',
      toolName: 'run_shell',
      args: {},
      emit,
      dangerous: true,
    })

    expect(resolveApproval('tc-2', 'reject')).toBe(false)
  })

  test('resolveApproval returns false for unknown toolCallId', () => {
    expect(resolveApproval('missing', 'approve')).toBe(false)
  })
})
